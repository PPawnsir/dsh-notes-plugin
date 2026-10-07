'use strict'
/* 0.4.7-B 用例㊱（notes-047-ux）app 端 UX 打磨真机矩阵：
 * ②a 顶栏无「速记合并」+ 建议器内入口保留；①a 设置卡滚到底保存恒见（sticky）；①b 长说明 ⓘ 收折/展开；
 * ⑦ 设置行「整理长度上限」+ 生效值透出；②b meta 行动区溢出菜单（6 动作触发：带 sessionId 笔记）；
 * ④a 三态 ⓘ（聚焦 + Enter toast 同文）；④b 挂载模态三岔（Esc=取消不切换 / 跳过=仅切角色不挂载）；
 * ⑤ 派发弹窗专属会话无界面提示行联动；⑥ 整理中遮罩 + 钮 spinner/禁用；⑥a 失败驻留条（5s 仍在 + ✕ 关闭）；
 * ⑥b 引导卡超限前置校验（settings-set 60 → 提示 + 确认禁用）。
 * 隔离纪律：自带新建笔记 + 人工延迟/设置覆写在 finally 复位（state 全 runner 共享）。 */
module.exports = {
  name: '㊱ 0.4.7-B UX 打磨：顶栏/sticky/ⓘ/溢出菜单/三态/挂载三岔/派发提示/整理三件套',
  async run({ base, browser, H, state }) {
    const page = await H.newPage(browser, base)
    const rpc = (method, args) => page.evaluate(({ method, args }) =>
      fetch('/dsh-notes', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ method, args }) }).then(r => r.json()),
      { method, args })
    try {
      await H.step(page, '36-ux-047b', async () => {
        /* ===== ②a 顶栏撤钮 + 建议器内入口保留 ===== */
        H.t('②a 顶栏无「速记合并」按钮（0.4.7-B②a）', await page.evaluate(() => !document.querySelector('#btnArchive')))
        await page.click('#btnSuggest')
        await H.waitFor(page, '建议框落定（六段分析完成）', async p =>
          p.evaluate(() => document.querySelector('#modalHost').textContent.indexOf('可整理的速记组') >= 0))
        H.t('②a 建议器首段「速记组」入口区保留（归档语义移入建议器）', true)
        await page.keyboard.press('Escape')
        await H.waitFor(page, '建议框关闭', async p => p.evaluate(() => document.querySelector('#modalHost').textContent === ''))

        /* ===== ①a 设置卡标题栏 sticky：滚到底保存恒见 ===== */
        await page.click('#btnSettings')
        await page.waitForSelector('#setBody .set-row', { timeout: 8000 })
        await H.waitFor(page, '设置卡内容落定（LLM 区渲染）', async p => p.evaluate(() => !!document.querySelector('#setOrgMax')))
        const stickyOk = await page.evaluate(() => {
          var modal = document.querySelector('#modalHost .modal')
          modal.scrollTop = modal.scrollHeight
          var mr = modal.getBoundingClientRect(), br = document.querySelector('#setSave').getBoundingClientRect()
          return br.top >= mr.top - 1 && br.bottom <= mr.bottom + 1 && document.querySelector('#setBody').scrollHeight > 0
        })
        H.t('①a 设置卡滚到底 → 标题栏「保存」恒见（sticky 顶吸）', stickyOk)
        /* ===== ⑦ 设置行「整理长度上限」+ 生效值透出（mock 回落 12000）===== */
        H.t('⑦ 设置卡 LLM 区出「整理长度上限」行（#setOrgMax，生效值 12000 透出入说明）', await page.evaluate(() => {
          var el = document.querySelector('#setOrgMax')
          return !!el && el.value === '0' && document.querySelector('#setBody').textContent.indexOf('当前生效 12000') >= 0
        }))
        /* ===== ①b 长说明收折 + ⓘ 展开 ===== */
        const clampOk = await page.evaluate(() => {
          var cl = document.querySelector('#setBody .set-label .s.cl')
          if (!cl) return false
          var sx = cl.parentElement.querySelector('.sx')
          if (!sx) return false
          sx.click()
          return !cl.classList.contains('cl')   // 展开
        })
        H.t('①b 长说明初态两行收折（.s.cl）+ ⓘ 点击展开（cl 摘除）', clampOk)
        await page.keyboard.press('Escape')
        await H.waitFor(page, '设置卡关闭', async p => p.evaluate(() => document.querySelector('#modalHost').textContent === ''))

        /* ===== ②b meta 行动区溢出菜单 ===== */
        await page.click('#tree .note-row')   // 种子 A：无 sessionId 无历史 = 5 动作
        await page.waitForSelector('#mOrganize', { timeout: 8000 })
        H.t('②b 常态 5 动作全直出（无溢出菜单触发钮）', await page.evaluate(() => !document.querySelector('#mActsMore') && !!document.querySelector('#mPin') && !!document.querySelector('#mDel')))
        const sidNote = await rpc('notes-create', { title: 'e2e ㊱溢出源笔记', body: '溢出菜单演习正文', sessionId: 'sess-e2e-0001' })
        await page.evaluate(() => loadNotes(true))
        await H.waitFor(page, '树中出现溢出源笔记', async p =>
          p.evaluate(() => document.querySelector('#tree').textContent.indexOf('e2e ㊱溢出源笔记') >= 0))
        await page.evaluate(() => { var rows = document.querySelectorAll('#tree .note-row'); for (var i = 0; i < rows.length; i++) if (rows[i].textContent.indexOf('e2e ㊱溢出源笔记') >= 0) { rows[i].click(); return } })
        await H.waitFor(page, '6 动作态：溢出触发钮出现', async p => p.evaluate(() => !!document.querySelector('#mActsMore')))
        H.t('②b 6 动作（+来源）触发封板：「…」溢出钮出现', true)
        H.t('②b 溢出后 pin/del 仍直出（不入菜单）', await page.evaluate(() => {
          var menu = document.querySelector('#mActsMenu')
          return !!document.querySelector('#edMeta > #mPin, #edMeta > span#mDel') && !(menu && menu.querySelector('#mPin'))
        }))
        await page.click('#mActsMore')
        await H.waitFor(page, '溢出菜单展开含「导出」', async p =>
          p.evaluate(() => { var m = document.querySelector('#mActsMenu'); return m && m.style.display !== 'none' && !!m.querySelector('#mExport') }))
        await page.click('#mActsMenu #mExport')
        await H.waitFor(page, '导出 toast 出现（菜单动作可用）', async p =>
          p.evaluate(() => document.querySelector('#toast').textContent.indexOf('已导出') >= 0))
        H.t('②b 溢出菜单动作行为级可用（导出 → 下载 + toast）+ 点菜收拢', await page.evaluate(() => document.querySelector('#mActsMenu').style.display === 'none'))

        /* ===== ④a 三态 ⓘ：可见 + 聚焦 + Enter toast 同文 ===== */
        H.t('④a 三态分段旁 ⓘ 可见且可聚焦（tabindex/role/aria）', await page.evaluate(() => {
          var el = document.querySelector('#mRoleInfo')
          return !!el && el.getAttribute('role') === 'button' && el.getAttribute('tabindex') === '0' && el.title.indexOf('关闭 = 不注入系统提示') >= 0 && el.title.indexOf('资料 = ') >= 0
        }))
        await page.evaluate(() => { document.querySelector('#mRoleInfo').focus(); document.querySelector('#mRoleInfo').click() })
        await H.waitFor(page, 'ⓘ 点击 toast 同文（触屏可达）', async p =>
          p.evaluate(() => document.querySelector('#toast').textContent.indexOf('约定 = 每次对话') >= 0))

        /* ===== ④b 挂载模态三岔：Esc=取消不切换；跳过=仅切换角色不挂载 ===== */
        const preMounts = await rpc('notes-mount-list', {})
        await page.evaluate(() => { var segs = document.querySelectorAll('#mRole .seg'); for (var i = 0; i < segs.length; i++) if (segs[i].getAttribute('data-role') === 'reference') { segs[i].click(); return } })
        await page.waitForSelector('#injMountSkip', { timeout: 8000 })
        H.t('④b 三态切「资料」弹挂载框 + 跳过档文案「仅切换角色，暂不挂载」', await page.evaluate(() =>
          document.querySelector('#injMountSkip').textContent.indexOf('仅切换角色，暂不挂载') >= 0))
        await page.keyboard.press('Escape')
        await H.waitFor(page, 'Esc 关挂载框', async p => p.evaluate(() => !document.querySelector('#injMountSkip')))
        H.t('④b Esc = 取消不切换（三态仍在关闭档 + 零挂载）', await page.evaluate(() =>
          document.querySelector('#mRole .seg[data-role="off"]').classList.contains('on')))
        await page.evaluate(() => { var segs = document.querySelectorAll('#mRole .seg'); for (var i = 0; i < segs.length; i++) if (segs[i].getAttribute('data-role') === 'reference') { segs[i].click(); return } })
        await page.waitForSelector('#injMountSkip', { timeout: 8000 })
        await page.click('#injMountSkip')
        await H.waitFor(page, '跳过档：角色切资料（on 态翻转）', async p =>
          p.evaluate(() => document.querySelector('#mRole .seg[data-role="reference"]').classList.contains('on')))
        const postMounts = await rpc('notes-mount-list', {})
        H.t('④b 跳过 = 仅切换角色暂不挂载（notes-mount 零调用）', (postMounts.lines || []).length === (preMounts.lines || []).length)

        /* ===== ⑤ 派发弹窗专属会话无界面提示行 ===== */
        await page.click('#mDispatch')
        await page.waitForSelector('#dTrigSched', { timeout: 8000 })
        H.t('⑤ 立即派发态无提示行', await page.evaluate(() => { var h = document.querySelector('#dSchedNewHint'); return h && h.style.display === 'none' }))
        await page.click('#dTrigSched')
        await page.waitForSelector('#dSchedNew', { timeout: 8000 })
        await page.click('#dSchedNew')
        await H.waitFor(page, '勾专属会话 → 无界面提示行出现', async p =>
          p.evaluate(() => { var h = document.querySelector('#dSchedNewHint'); return h && h.style.display !== 'none' && h.textContent.indexOf('无界面会话') >= 0 }))
        H.t('⑤ 提示行文案 = 无浏览器等 GUI 附着工具（双语键 zh 态）', true)
        await page.selectOption('#dSchedMode', 'once')
        await H.waitFor(page, '切「仅一次」→ 提示行同隐', async p =>
          p.evaluate(() => document.querySelector('#dSchedNewHint').style.display === 'none'))
        H.t('⑤ 「仅一次」模式提示行联动隐藏', true)
        await page.click('#dCancel')

        /* ===== ⑥ 整理中态：遮罩 + 钮 spinner/禁用（人工延迟 1.5s 锁定窗口期）===== */
        state._delays = state._delays || {}
        state._delays['notes-ai-organize'] = 1500
        await H.createNoteViaUI(page, 'e2e ㊱整理中态', '整理遮罩演习正文')
        await page.click('#tree .note-row:has-text("e2e ㊱整理中态")')
        await H.waitFor(page, '正文落定', async p =>
          p.evaluate(() => { var ta = document.querySelector('#edSrc'); return ta && ta.value.indexOf('整理遮罩演习正文') >= 0 }))
        await page.click('#mOrganize')
        await page.waitForSelector('#oiOk', { timeout: 8000 })
        await page.click('#oiOk')
        await H.waitFor(page, '整理中遮罩 + spinner 出现', async p =>
          p.evaluate(() => { var v = document.querySelector('#orgVeil'); return v && v.style.display !== 'none' && v.textContent.indexOf('约需半分钟') >= 0 && !!v.querySelector('.org-spin') }))
        H.t('⑥ 整理中正文区遮罩（「AI 整理中，约需半分钟…」+ spinner）DOM 锚', true)
        H.t('⑥ meta 钮整理中 spinner/禁用态（busy）', await page.evaluate(() => {
          var b = document.querySelector('#mOrganize')
          return b.classList.contains('busy') && !!b.querySelector('.org-spin') && b.textContent.indexOf('整理中') >= 0
        }))
        await H.waitFor(page, '整理落定：遮罩消失 + 正文替换', async p =>
          p.evaluate(() => { var v = document.querySelector('#orgVeil'); var ta = document.querySelector('#edSrc'); return v && v.style.display === 'none' && ta && ta.value.indexOf('## 已整理') >= 0 }))
        await page.waitForSelector('#toastAct', { timeout: 8000 })
        await page.click('#toastAct')   /* 撤销栈回归：恢复原文 */
        await H.waitFor(page, '撤销恢复整理前正文', async p =>
          p.evaluate(() => { var ta = document.querySelector('#edSrc'); return ta && ta.value.indexOf('整理遮罩演习正文') >= 0 }))
        H.t('⑥ 既有 organize 容错/撤销栈语义零改动（撤销回原文）', true)
        state._delays['notes-ai-organize'] = 0

        /* ===== ⑥a 失败驻留条：5s 仍在（非一闪而过）+ ✕ 手动关闭 =====
           （笔记标题避开「整理失败」子串——草稿落库 toast 带标题会误命中断言） */
        await H.createNoteViaUI(page, 'e2e ㊱驻留', '[org-err] 失败驻留演习正文')
        await page.click('#tree .note-row:has-text("e2e ㊱驻留")')
        await H.waitFor(page, '正文落定', async p =>
          p.evaluate(() => { var ta = document.querySelector('#edSrc'); return ta && ta.value.indexOf('[org-err]') >= 0 }))
        await page.click('#mOrganize')
        await page.waitForSelector('#oiOk', { timeout: 8000 })
        await page.click('#oiOk')
        await H.waitFor(page, '失败驻留条出现', async p =>
          p.evaluate(() => { var b = document.querySelector('#orgErr'); return b && b.style.display !== 'none' && b.textContent.indexOf('整理失败') >= 0 }))
        await H.sleep(5000)   /* toast 早亡（秒级）；驻留条应在 */
        const diag = await page.evaluate(() => {
          var b = document.querySelector('#orgErr')
          return JSON.stringify({
            hasBanner: !!b, disp: b ? b.style.display : '(none)', msg: b ? document.querySelector('#orgErrMsg').textContent : '',
            toast: document.querySelector('#toast').textContent, err: typeof organizeErr !== 'undefined' ? organizeErr : '(undef)',
            organizing: typeof organizing !== 'undefined' ? organizing : '(undef)',
          })
        })
        console.log('  [diag ⑥a]', diag)
        H.t('⑥a 失败提示驻留化（5s 后仍在，不再一闪而过）', await page.evaluate(() => {
          var b = document.querySelector('#orgErr')
          return b && b.style.display !== 'none' && document.querySelector('#toast').textContent.indexOf('mock 整理失败演示') < 0
        }), () => diag)
        await page.click('#orgErrX')
        H.t('⑥a ✕ 手动关闭驻留条', await page.evaluate(() => document.querySelector('#orgErr').style.display === 'none'))

        /* ===== ⑥b 超限前置校验：设置卡 UI 改上限 40（顺带真测 orgMaxCache 失效钩子——此前引导卡已开过，缓存 12000）→ 提示 + 确认禁用 ===== */
        await page.click('#btnSettings')
        await page.waitForSelector('#setOrgMax', { timeout: 8000 })
        await page.fill('#setOrgMax', '40')
        await page.evaluate(() => document.querySelector('#setOrgMax').dispatchEvent(new Event('change')))
        await H.waitFor(page, '上限保存 toast（缓存失效钩子同路径）', async p =>
          p.evaluate(() => document.querySelector('#toast').textContent.indexOf('已保存：整理长度上限 40') >= 0))
        H.t('⑦ 设置卡 UI 保存整理长度上限 40（orgMaxCache 失效钩子触发）', await page.evaluate(() => orgMaxCache === 0))
        await page.keyboard.press('Escape')
        await H.waitFor(page, '设置卡关闭', async p => p.evaluate(() => document.querySelector('#modalHost').textContent === ''))
        await H.createNoteViaUI(page, 'e2e ㊱超限', '这是一段刻意超过四十个字上限的整理前置校验演习正文，需要足够长才能触发引导卡的超限提示与确认钮禁用态。')
        await page.click('#tree .note-row:has-text("e2e ㊱超限")')
        await H.waitFor(page, '正文落定', async p =>
          p.evaluate(() => { var ta = document.querySelector('#edSrc'); return ta && ta.value.length > 40 }))
        await page.click('#mOrganize')
        await H.waitFor(page, '超限提示 + 确认禁用（读 settings-get 生效值 40）', async p =>
          p.evaluate(() => { var h = document.querySelector('#oiLimit'); var ok = document.querySelector('#oiOk'); return h && h.style.display !== 'none' && h.textContent.indexOf('超上限 40') >= 0 && ok && ok.disabled }))
        H.t('⑥b 引导卡超限前置校验：「本篇 N 字超上限 40」+ 开始整理禁用', true)
        await page.click('#oiCancel')
        await rpc('notes-settings-set', { organizeMaxChars: 0 })
        await H.screenshot(page, '36-ux-047b')
      })
    } finally {
      try { if (state._delays) state._delays['notes-ai-organize'] = 0 } catch (e) {}
      try { await page.evaluate(() => fetch('/dsh-notes', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ method: 'notes-settings-set', args: { organizeMaxChars: 0 } }) })) } catch (e) {}
      await page.context().close()
    }
  },
}
