'use strict'
/* 0.4.5-B 用例㉓（notes-045-ux-polish）：
 * ① 调度约定 target='new' 目标位「→ new」生硬显示 → 「首轮自动创建专属会话」（disp.schedNewTarget）——
 *    计划块（editor-meta）+ 注入管理调度任务区（inject-manager）双展示点真实 DOM 实证；
 * ② 机器档（恰选「机器」kinds=['sys']）+ 混合夹（夹内含普通笔记 + sys 条目）：切档/刷新零多余 notes-list {folder}
 *    定向请求（惰性闸口径修正——旧口径 count 差值实为隐藏普通笔记数，误度量多发一次；0.4.4-C verifier 残留），
 *    且 sys 子行照常渲染（主缓存 ⑩ kind 通道直供）、普通笔记不入档内列表；切回缺省档补拉恢复（回归双向锁）。
 * fixture 经 RPC 面预置（先于页面加载）；RPC 侦测走 page.on('request') 旁记（folder 定向请求计数 = 惰性闸判据，同用例⑱ 口径）。 */
module.exports = {
  name: '㉓ 0.4.5-B：target=new 新文案双展示点 + 机器档混合夹零多余定向请求 + 缺省档回归',
  async run({ base, browser, H }) {
    /* fixture 预置（RPC 面）：混合夹（1 普通 + 1 sys）+ target='new' 调度约定 */
    const rpc = (method, args) => fetch(base + '/dsh-notes', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ method, args: args || {} }),
    }).then(r => r.json())
    const fRes = await rpc('notes-folders', { op: 'create', name: 'e2e 混合夹B' })
    const mixFid = fRes && fRes.folder && fRes.folder.id
    if (!mixFid) throw new Error('fixture 失败：混合夹创建返回 ' + JSON.stringify(fRes))
    const nNorm = await rpc('notes-create', { title: 'e2e 混合夹普通笔记', body: 'x', folder: mixFid })
    const nSys = await rpc('notes-create', { title: 'e2e 混合夹机器条目', body: 'x', kind: 'sys', folder: mixFid })
    const sched = await rpc('notes-create', { title: '定时 e2e 专属巡检', body: '巡检正文', kind: 'todo', contractType: 'dispatch-schedule', schedule: { every: '3d', anchor: '09:00', target: 'new', action: 'dispatch', enabled: true } })
    if (!nNorm.id || !nSys.id || !sched.id) throw new Error('fixture 失败：笔记创建')

    /* 手工建页（先挂 request 侦测再 goto——folder 定向请求计数从首载起算，同用例⑱ 口径） */
    const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } })
    const page = await ctx.newPage()
    const consoleErrors = []
    page.on('console', m => { if (m.type() === 'error') consoleErrors.push(m.text()) })
    page.on('pageerror', e => consoleErrors.push('pageerror: ' + (e && e.message || e)))
    page.__consoleErrors = consoleErrors
    const rpcLog = []   /* { method, folder, kind } —— 只记 /dsh-notes POST */
    page.on('request', req => {
      try {
        if (req.method() !== 'POST' || req.url().indexOf('/dsh-notes') < 0) return
        const b = JSON.parse(req.postData() || '{}')
        rpcLog.push({ method: b.method, folder: b.args && b.args.folder, kind: b.args && b.args.kind })
      } catch (e) {}
    })
    const folderFetchN = fid => rpcLog.filter(r => r.method === 'notes-list' && r.folder === fid).length

    try {
      await page.goto(base + '/', { waitUntil: 'load' })
      await page.waitForSelector('#tree', { timeout: 15000 })
      await H.step(page, '23-ux-polish', async () => {
        const rowCnt = kw => page.evaluate(k => {
          var n = 0
          document.querySelectorAll('#tree .note-row .ti').forEach(function (el) { if (el.textContent.indexOf(k) >= 0) n++ })
          return n
        }, kw)

        /* ① 缺省档基线：混合夹藏 sys（count=2 含普通笔记，缓存可见=1）→ 0.4.4-C 惰性闸照常补拉恰 1 次（不回归锚） */
        await H.waitFor(page, '缺省档混合夹 sys 行补拉可见', async () => (await rowCnt('e2e 混合夹机器条目')) === 1)
        H.t('缺省档混合夹补拉恰 1 次定向 {folder} 请求（0.4.4-C 惰性闸不回归）', folderFetchN(mixFid) === 1, () => '实得 ' + folderFetchN(mixFid) + ' 次')

        /* ② 计划块新文案：打开 target='new' 调度约定 → meta 计划块目标位显示人话，零「→ new」残留 */
        await page.click('#tree .note-row:has-text("定时 e2e 专属巡检")')
        await H.waitFor(page, '计划块渲染（sched-target 目标位）', async () => page.evaluate(() => !!document.querySelector('#edMeta .sched-plan .sched-target')))
        const planTxt = await page.evaluate(() => { var el = document.querySelector('#edMeta .sched-plan .sched-target'); return el ? el.textContent : '' })
        H.t('计划块 target=new 显示「首轮自动创建专属会话」', planTxt === '首轮自动创建专属会话', () => '实得「' + planTxt + '」')
        const planTip = await page.evaluate(() => { var el = document.querySelector('#edMeta .sched-plan .sched-target'); return el ? (el.getAttribute('title') || '') : '' })
        H.t('计划块 tooltip 仍携原始 target 机器值（new）', planTip === 'new', () => '实得「' + planTip + '」')

        /* ③ 注入管理调度任务区同款新文案（设置卡 → 注入管理 → 调度任务区行） */
        await page.click('#btnSettings')
        await page.waitForSelector('#setInjectManager', { timeout: 8000 })
        await page.click('#setInjectManager')
        await H.waitFor(page, '调度任务区行渲染', async () => page.evaluate(() => !!document.querySelector('#injSchedHost .sched-row .sched-target')))
        const rowTxt = await page.evaluate(() => { var el = document.querySelector('#injSchedHost .sched-row .sched-target'); return el ? el.textContent : '' })
        H.t('调度任务区 target=new 显示「首轮自动创建专属会话」', rowTxt === '首轮自动创建专属会话', () => '实得「' + rowTxt + '」')
        /* 关弹层回主界面：Esc 关注入管理（返回栈重开设置卡）→ Esc 关设置卡 */
        await page.keyboard.press('Escape')
        await page.waitForSelector('#setClose', { timeout: 8000 })
        await page.keyboard.press('Escape')
        await H.waitFor(page, '弹层全关（modalHost 清空）', async () => page.evaluate(() => !document.querySelector('#modalHost').firstChild))

        /* ④ 机器档 + 混合夹：切档 → 主缓存换代（{kind:'sys'} 通道）→ refreshSysKids 复核——零新增 {folder} 定向请求 */
        await page.click('#btnFilter')
        await page.waitForSelector('#fpop input[data-fk="sys"]', { timeout: 8000 })
        const nBase = folderFetchN(mixFid)
        await page.click('#fpop input[data-fk="sys"]')
        await H.waitFor(page, '机器档生效（kind 通道重取）', async () => rpcLog.some(r => r.method === 'notes-list' && r.kind === 'sys'))
        await H.waitFor(page, '机器档混合夹 sys 行自主缓存直供渲染', async () => (await rowCnt('e2e 混合夹机器条目')) >= 1)
        H.t('机器档普通笔记不入列表（恰选单 kind 传 host，⑩ 口径）', (await rowCnt('e2e 混合夹普通笔记')) === 0)
        await H.sleep(400)   /* 效应 settle 窗口：复核/补拉若有必在此窗口内发出 */
        H.t('机器档混合夹零新增 {folder} 定向请求（惰性闸口径修正：count 差值不再误度量）', folderFetchN(mixFid) === nBase, () => '实得 ' + folderFetchN(mixFid) + ' 次（切档前基准 ' + nBase + '）')

        /* ⑤ 机器档刷新：loadNotes 换代 → refreshSysKids 复核——仍零新增（缓存已有该夹 sys 行且 stamp 恒新鲜） */
        await page.click('#btnRefresh')
        await H.waitFor(page, '机器档刷新后 sys 行仍在', async () => (await rowCnt('e2e 混合夹机器条目')) >= 1)
        await H.sleep(400)
        H.t('机器档刷新零新增 {folder} 定向请求（防陈旧复核同豁免）', folderFetchN(mixFid) === nBase, () => '实得 ' + folderFetchN(mixFid) + ' 次（基准 ' + nBase + '）')

        /* ⑥ 切回缺省档：缓存换代 → 混合夹藏 sys → 惰性闸恢复补拉 +1（双向回归锁）；sys 行照常可见。
           注意：⑤ 的 #btnRefresh 点击在 #filterbar 外 → 外部点击关闭浮层（folders.js 同口径），此处按态重开 */
        if (!(await page.$('#fpop.open'))) { await page.click('#btnFilter'); await page.waitForSelector('#fpop.open input[data-fk="sys"]', { timeout: 8000 }) }
        await page.click('#fpop input[data-fk="sys"]')
        await H.waitFor(page, '回缺省档普通笔记恢复可见', async () => (await rowCnt('e2e 混合夹普通笔记')) === 1)
        await H.waitFor(page, '回缺省档惰性闸恢复补拉（+1）', async () => folderFetchN(mixFid) === nBase + 1)
        H.t('回缺省档 sys 行仍在（补拉覆盖，不闪断）', (await rowCnt('e2e 混合夹机器条目')) === 1)

        H.t('无 console error / pageerror', page.__consoleErrors.length === 0, () => page.__consoleErrors.slice(0, 3).join(' | '))
        await H.screenshot(page, '23-ux-polish')
      })
    } finally { await page.context().close() }
  },
}
