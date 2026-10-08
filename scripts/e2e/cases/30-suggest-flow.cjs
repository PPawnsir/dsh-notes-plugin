'use strict'
/* 0.4.6-E 用例㉚（notes-046-suggest-flow）：建议器/注入流断点批 e2e 收口——
 * ① 约定档二次确认闸：dismiss 不翻转（零副作用）/ accept 才生效 + 确认条文案「将对…生效」；
 * ② MountModal 预填三态：加载态状态行 → mock 无 LLM 走失败态「预填不可用，请手写」（tooltip 带原因）+ 回退预填标题 + 跳过改名「不用建议，自己写」；
 * ③ 建议器「零引用挂载」段空态口径统一（段头 + 0 条 + 当前无行）+ 高频段挂载确认后就地回开 + 滚动位置保持 + 候选收敛（25→24）；
 * ④ 注入管理统计行「截至 HH:MM」+ 挂载计数实时（mountNow：挂一笔 +1，快照 mountTotal 定格 0 不动）。
 * 隔离纪律：高频候选经 state._suggestHot 注入（用例结束清零）；mock notes-mount/notes-recall-stats 状态化（server.cjs 0.4.6-E 节注）。 */
module.exports = {
  name: '㉚ 0.4.6-E 建议器/注入流断点批：约定确认闸 + 预填三态 + 回开滚动保持 + 空态统一 + 统计行截至/实时计数',
  async run({ base, browser, H, state }) {
    const page = await H.newPage(browser, base)
    /* 对话框管控：dlgAccept 开关 + 文案录制（确认闸两态演练；Playwright 缺省 dismiss 对话框） */
    let dlgAccept = true
    const dlgMsgs = []
    page.on('dialog', d => { dlgMsgs.push(d.message()); if (dlgAccept) d.accept().catch(() => {}); else d.dismiss().catch(() => {}) })
    const rpc = (method, args) => fetch(base + '/dsh-notes', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ method, args: args || {} }),
    }).then(r => r.json())
    const boltCount = (title) => page.evaluate(t2 => {
      var rows = document.querySelectorAll('#tree .note-row')
      for (var i = 0; i < rows.length; i++) {
        if (rows[i].textContent.indexOf(t2) >= 0) return rows[i].querySelectorAll('use[href="#i-bolt"]').length
      }
      return -1
    }, title)
    const m0 = await rpc('notes-recall-stats', {})
    const mountBase = (m0 && typeof m0.mountNow === 'number') ? m0.mountNow : 0
    /* 0.4.8 契约对账（notes-048-mock-contract-audit）：mock notes-mount 已对齐 host 存在性校验闸——
       高频候选合成 id（sg-hot-*）必须在 mock state 预建真实笔记（否则挂载被拒，真机口径）；用例结束清零纪律不变 */
    const hotIds = {}
    try {
      await H.step(page, '30-suggest-flow', async () => {
        /* ===== ① 约定档二次确认闸：dismiss 零副作用 / accept 生效 ===== */
        await H.createNoteViaUI(page, 'e2e 约定闸探针', '约定确认闸正文')
        await page.click('#tree .note-row:has-text("e2e 约定闸探针")')
        await page.waitForSelector('#mRole', { timeout: 8000 })
        dlgAccept = false
        await page.click('#mRole .seg[data-role="convention"]')
        await H.waitFor(page, '确认条弹出（文案含「将对…生效」）', async () => Promise.resolve(dlgMsgs.length >= 1 && dlgMsgs[0].indexOf('将对') >= 0))
        H.t('约定档点击弹二次确认（文案「将对…生效」）', dlgMsgs[0].indexOf('所有会话') >= 0 && dlgMsgs[0].indexOf('e2e 约定闸探针') >= 0, () => '实得文案：' + dlgMsgs[0])
        await H.sleep(700)   // 越过任何误保存窗口
        H.t('dismiss 确认条 = 零副作用（未翻约定档，树行无 bolt 徽章）', (await boltCount('e2e 约定闸探针')) === 0)
        const onRoleAfterDismiss = await page.evaluate(() => { var on = document.querySelector('#mRole .seg.on'); return on ? on.getAttribute('data-role') : '' })
        H.t('dismiss 后三态仍在 off 档', onRoleAfterDismiss === 'off', () => '实得档位：' + onRoleAfterDismiss)
        dlgAccept = true
        await page.click('#mRole .seg[data-role="convention"]')
        await H.waitFor(page, 'accept 后树行出现 bolt 徽章（翻约定档）', async p => (await boltCount('e2e 约定闸探针')) === 1)
        const bcAccept = await boltCount('e2e 约定闸探针')   /* 0.4.7-A⑤：恒真标记落实为真断言 */
        H.t('accept 确认条 = 约定档生效（bolt 徽章在）', bcAccept === 1, () => '实得 bolt 数：' + bcAccept)

        /* ===== ② MountModal 预填三态（mock 无 LLM → 失败态可见）+ 跳过改名 ===== */
        await H.createNoteViaUI(page, 'e2e 预填三态探针', '预填正文')
        await page.click('#tree .note-row:has-text("e2e 预填三态探针")')
        await page.waitForSelector('#mRole', { timeout: 8000 })
        await page.click('#mRole .seg[data-role="reference"]')
        await page.waitForSelector('#injMountWhen', { timeout: 8000 })
        H.t('切「资料」档弹挂载框', await page.evaluate(() => !!document.querySelector('#injMountWhen')))   /* 0.4.7-A⑤：真断言 */
        /* 加载态：mock 响应快，加载行可能一闪而过——两态必居其一（gen 行或 err 行）且最终落 err */
        await H.waitFor(page, '失败态状态行可见（预填不可用，请手写）', async p =>
          p.evaluate(() => { var el = document.querySelector('#injMountStat'); return el && el.className.indexOf('err') >= 0 && el.textContent.indexOf('预填不可用') >= 0 }))
        const statTip = await page.evaluate(() => { var el = document.querySelector('#injMountStat'); return el ? (el.getAttribute('title') || '') : '' })
        H.t('失败态 tooltip 携带原始原因（非空）', statTip.length > 0, () => '实得 title：' + statTip)
        const whenVal = await page.evaluate(() => document.querySelector('#injMountWhen').value)
        H.t('失败回退预填标题（契约不动：挂载不被草稿失败阻断）', whenVal === 'e2e 预填三态探针', () => '实得预填：' + whenVal)
        const skipTxt = await page.evaluate(() => { var b = document.querySelector('#injMountSkip'); return b ? b.textContent : '' })
        /* 0.4.7-B④b（notes-047-ux）：角色切换在途入口的跳过档语义改「仅切换角色，暂不挂载」（第三岔）；
           「不用建议，自己写」（inj.mountSkip）保留给建议器/预览等纯挂载入口 */
        H.t('跳过按钮（角色切换在途）=「仅切换角色，暂不挂载」（0.4.7-B④b）', skipTxt === '仅切换角色，暂不挂载', () => '实得：' + skipTxt)
        await page.click('#injMountSave')
        await H.waitFor(page, '确认后挂载框关闭', async p => p.evaluate(() => !document.querySelector('#injMountWhen')))
        await H.waitFor(page, '确认后树行出现 bolt 徽章（翻 reference 档）', async p => (await boltCount('e2e 预填三态探针')) === 1)
        const bcMount = await boltCount('e2e 预填三态探针')   /* 0.4.7-A⑤：真断言 */
        H.t('挂载确认落行（mock notes-mount 登记，统计行计数待④核验）', bcMount === 1, () => '实得 bolt 数：' + bcMount)

        /* ===== ③ 建议器：零引用段空态统一 + 高频挂载就地回开 + 滚动保持 + 候选收敛 ===== */
        const hot = []
        for (let i = 1; i <= 25; i++) hot.push({ id: 'sg-hot-' + i, title: 'e2e 高频候选 ' + String(i).padStart(2, '0'), topic: '', hits: 5, updatedAt: '' })
        state._suggestHot = hot
        /* 高频候选同步预建真实笔记（契约闸造数，字段集对齐 mock 种子口径）——挂载目标真实存在 */
        const nowIso30 = new Date().toISOString()
        for (const h of hot) {
          hotIds[h.id] = true
          state.notes.push({ id: h.id, title: h.title, body: 'e2e 高频候选占位正文（契约闸造数）', topic: '', kind: 'note', tags: [], status: 'active', inject: false, injectEver: false, injectRole: 'convention', injectTo: [], recall: true, sensitive: false, hidden: false, workspace: 'e2e-workspace', folder: '', sessionId: '', cwd: '', logDate: '', entities: [], summarizedAt: '', contractType: '', origin: '', schedule: undefined, mergedFrom: [], dispatches: [], refNote: '', runLog: '', useCount: 0, archivedAt: '', createdAt: nowIso30, updatedAt: nowIso30, deleted: false })
        }
        await page.click('#btnSuggest')
        await page.waitForSelector('#suggestList', { timeout: 8000 })
        await H.waitFor(page, '建议器数据到位（高频段 25 条）', async p =>
          p.evaluate(() => { var el = document.querySelector('#suggestList'); return el && el.textContent.indexOf('高频取用未挂载') >= 0 && el.textContent.indexOf('25 条') >= 0 }))
        const zrTxt = await page.evaluate(() => {
          var secs = document.querySelectorAll('#suggestList .sg-sec')
          for (var i = 0; i < secs.length; i++) if (secs[i].textContent.indexOf('零引用挂载') >= 0) return secs[i].textContent
          return ''
        })
        H.t('零引用段空态口径统一：段头 + 0 条 + 「当前无」行（整段不再缺席）', zrTxt.indexOf('零引用挂载') >= 0 && zrTxt.indexOf('0 条') >= 0 && zrTxt.indexOf('当前无零引用挂载候选') >= 0, () => '实得段文本：' + zrTxt.slice(0, 90))
        /* 滚动到 200 → 点一个可视的「挂载」→ MountModal 确认 → 建议器回开且滚动保持 */
        await page.evaluate(() => { document.querySelector('#modal').scrollTop = 200 })
        const pickId = await page.evaluate(() => {
          var btns = document.querySelectorAll('#suggestList .sg-mount')
          for (var i = 0; i < btns.length; i++) {
            var r = btns[i].getBoundingClientRect()
            if (r.top >= 0 && r.bottom <= window.innerHeight) return btns[i].getAttribute('data-id')
          }
          return ''
        })
        H.t('滚动后可视区内找到挂载按钮（候选 ' + pickId + '）', !!pickId)
        await page.click('#suggestList .sg-mount[data-id="' + pickId + '"]')
        await page.waitForSelector('#injMountWhen', { timeout: 8000 })
        H.t('挂载弹层接管（modal 不叠 modal）', await page.evaluate(() => !!document.querySelector('#injMountWhen')))   /* 0.4.7-A⑤：真断言 */
        await H.waitFor(page, '预填失败态落定', async p =>
          p.evaluate(() => { var el = document.querySelector('#injMountStat'); return el && el.className.indexOf('err') >= 0 }))
        await page.click('#injMountSave')
        await H.waitFor(page, '确认后建议器就地回开（高频段在）', async p =>
          p.evaluate(() => { var el = document.querySelector('#suggestList'); return el && el.textContent.indexOf('高频取用未挂载') >= 0 }))
        const reopened = await page.evaluate(() => { var el = document.querySelector('#suggestList'); return !!(el && el.textContent.indexOf('高频取用未挂载') >= 0) })   /* 0.4.7-A⑤：真断言 */
        H.t('挂载确认后回开建议器（批处理连续作业）', reopened)
        const scAfter = await page.evaluate(() => document.querySelector('#modal').scrollTop)
        H.t('回开滚动位置保持（存档 200，实得 ' + scAfter + '）', scAfter >= 180, () => '实得 scrollTop ' + scAfter)   /* 0.4.7-A⑤：阈值 150 → 180 收紧（verifier 注） */
        await H.waitFor(page, '高频段候选收敛 25→24（已挂载摘除）', async p =>
          p.evaluate(() => { var el = document.querySelector('#suggestList'); return el && el.textContent.indexOf('高频取用未挂载') >= 0 && el.textContent.indexOf('24 条') >= 0 }))
        const converged = await page.evaluate(() => { var el = document.querySelector('#suggestList'); return !!(el && el.textContent.indexOf('24 条') >= 0) })   /* 0.4.7-A⑤：真断言 */
        H.t('候选收敛：已挂载条目从高频段摘除', converged)
        /* 关建议框 */
        await page.click('#suggestClose')

        /* ===== ④ 注入管理统计行：截至时刻 + 挂载计数实时（mountNow = base+2）===== */
        await page.click('#btnSettings')
        await page.waitForSelector('#setInjectManager', { timeout: 8000 })
        await page.click('#setInjectManager')
        await page.waitForSelector('#injMntStatsRow', { timeout: 8000 })
        const rowTxt = await page.evaluate(() => { var el = document.querySelector('#injMntStatsRow'); return el ? el.textContent : '' })
        H.t('统计行含「截至 HH:MM」时刻标注', /截至 \d{2}:\d{2}/.test(rowTxt), () => '实得行：' + rowTxt)
        H.t('挂载计数实时（mountNow=' + (mountBase + 2) + '，快照 mountTotal=0 不参与）', rowTxt.indexOf('挂载 ' + (mountBase + 2)) >= 0, () => '实得行：' + rowTxt)

        /* 清理共享 mock 状态（零耦合纪律：候选清单 + 预建笔记同步摘除） */
        state._suggestHot = null
        state.notes = state.notes.filter(n => !hotIds[n.id])
        H.t('无 console error / pageerror', page.__consoleErrors.length === 0, () => page.__consoleErrors.slice(0, 3).join(' | '))
        await H.screenshot(page, '30-suggest-flow')
      })
    } finally { state._suggestHot = null; state.notes = state.notes.filter(n => !hotIds[n.id]); await page.context().close() }
  },
}
