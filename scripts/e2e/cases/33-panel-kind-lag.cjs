'use strict'
/* 0.4.7-D1 用例㉝：kind 滞后路径真机锁（0.4.6-K notes-046-kind-lag 的 e2e 真机版）。
 * 0.4.7-D2（notes-047-panel-e2e-migrate）扩为 check 节 101.1「假 React 序位仿真」eval 的完整真机替代——
 *   原 eval 用 Proxy 世界按声明序手排 effect（kindsEffect → syncEffect）断言五档 + 监听器兜底；
 *   本用例在真 React 18 渲染树里连续勾选/摘除类型档，harness 录制 notes-list 实收参数序列逐档比对：
 *
 * == 迁移映射（原 eval 断言 → 本用例真机锁；退役裁决见 check/sections/101-kind-filter-lag.cjs 101.1 块注）==
 *   eval 档①「缺省 kinds=[]：零 kind 参数」            → 步①开板无参（既有锁保留）
 *   eval 档②「勾『机器』[sys]：当次即 kind=sys」        → 步③（修复前此处会打出上一拍无参）
 *   eval 档③「多选 [sys,note]：当次即回无参」           → 步④（修复前此处会打出滞留 kind=sys）+ DOM 3 行口径锁
 *   eval 档④「清空 kinds=[]：当次即回无参」             → 步⑥（经步⑤ [note] 中间档，真机 UI 连续两次摘除）
 *   eval「每次 kinds 变更恰一次 notes-list 重拉」       → 每档 delta===1 计数锁 + 收尾全序列逐位相等
 *   eval 档⑤「恰选 note：当次即 kind=note」            → 步⑧（兜底腿后复勾）
 *   eval「监听器兜底：kinds=[] → 无参 / [note] → kind=note」（loadNotes(true) 无显式参 → filtersRef 镜像）
 *     → 步⑦/步⑨：编辑器删除笔记触发 doDelete→loadNotes(true)+notifyNotesChanged→监听器/📎徽标重拉，
 *       三连 notes-list 全部走 filtersRef 镜像路径（无显式 kindsNow），实收参数与当次档一致
 *   附加锁（非 eval 映射，D1 既有保留）：「日志」档 kind=log 通道 + DOM 行集合/命中计数随档一致。
 *
 * 桩数据：3 笔记 + 2 日志（工作日志夹，缺省展开）+ 1 决策 + 1 机器（sys，缺省列表排除） = 缺省 6 行。 */
const { mountPanel } = require('../panel-harness.cjs')

function mk(id, title, kind, folder, i) {
  const ts = new Date(Date.now() - i * 1000).toISOString()
  return { id, title, body: title + ' 正文', topic: '', kind, tags: [], status: 'active', pinned: false, inject: false, injectRole: '', injectTo: [], recall: true, folder: folder || '', useCount: 0, contractType: '', createdAt: ts, updatedAt: ts, deleted: false }
}

module.exports = {
  name: '㉝ 面板筛选中心 kind 滞后真机锁：连续变更五档 + 监听器兜底，RPC 参数序列与当次 filters 逐位一致',
  async run({ browser, H }) {
    const h = await mountPanel(browser, {
      seed(state) {
        state.notes.length = 0
        state.notes.push(
          mk('kl-n1', 'K锁笔记一', 'note', '', 1), mk('kl-n2', 'K锁笔记二', 'note', '', 2), mk('kl-n3', 'K锁笔记三', 'note', '', 3),
          mk('kl-l1', 'K锁日志甲', 'log', 'f-log-e2e', 4), mk('kl-l2', 'K锁日志乙', 'log', 'f-log-e2e', 5),
          mk('kl-d1', 'K锁决策丙', 'decision', '', 6),
          mk('kl-s1', 'K锁机器丁', 'sys', '', 7))   /* 0.4.7-D2：sys 档样本（缺省列表排除，「机器」档直达） */
      },
    })
    /* notes-list 实收 kind 参数序列（undefined 参数 = 无参缺省口径，记 ''） */
    const listKinds = () => h.rpcCalls.filter(c => c.method === 'notes-list')
      .map(c => (c.args && c.args.kind) ? c.args.kind : '')
    const lastListKind = () => {
      const ks = listKinds()
      return ks.length ? ks[ks.length - 1] : '(no-call)'
    }
    const rowCnt = () => h.page.evaluate(() => document.querySelectorAll('.dsh-notes-tree .dsh-notes-note-row').length)
    const rowTitles = () => h.page.evaluate(() =>
      Array.from(document.querySelectorAll('.dsh-notes-tree .dsh-notes-note-row .dsh-notes-note-ti')).map(el => el.textContent).join('|'))
    const hitTxt = () => h.page.evaluate(() => {
      const el = document.querySelector('.dsh-notes-fpop-pcnt')
      return el ? el.textContent.trim() : '(missing)'
    })
    /* 点类型组某档复选框（label 内 input 真实点击 → React onChange 链路） */
    const clickKind = async (label) => {
      const item = h.page.locator('.dsh-notes-fpop label.dsh-notes-fg-item', { has: h.page.locator('.dsh-notes-fg-fl', { hasText: label }) }).first()
      await item.locator('input[type=checkbox]').click()
    }
    /* 一档变更（点击前先在调用侧捕获计数）后等待落定 + 「恰一次重拉且参数=当次档」双锁 */
    const expectKind = async (desc, before, wantKind, wantRows) => {
      await H.waitFor(h.page, desc, async () =>
        lastListKind() === wantKind && listKinds().length === before + 1 && (wantRows == null || (await rowCnt()) === wantRows))
      return true
    }
    try {
      await H.step(h.page, '33-panel-kind-lag', async () => {
        await h.openPanel()
        /* 步① 档①：缺省 kinds=[] → 无参；sys 排除在缺省列表外（6 行） */
        await H.waitFor(h.page, '开板 6 行全量（sys 不入缺省列表）', async () => (await rowCnt()) === 6)
        H.t('档①锁：开板 notes-list 无 kind 参数 + 6 行全量（3 笔记+2 日志+1 决策；sys 排除）',
          listKinds().length >= 1 && listKinds().every(k => k === '') && true, () => 'seq=' + JSON.stringify(listKinds()))

        /* 打开筛选中心 */
        await h.page.click('.dsh-notes-fbtn-filter')
        await h.page.waitForSelector('.dsh-notes-fpop', { timeout: 8000 })
        H.t('筛选中心浮层打开', true)

        /* 步② 附加锁：勾「日志」——恰选 1 kind → {kind:'log'}，2 行命中（D1 既有） */
        let nAt = listKinds().length
        await clickKind('日志')
        H.t('档L锁：勾「日志」→ notes-list 实收 kind=log 恰一次 + 2 行', await expectKind('勾日志落定', nAt, 'log', 2))
        const onlyLogs = await rowTitles()
        H.t('档L锁：DOM 仅两条日志行', /K锁日志甲/.test(onlyLogs) && /K锁日志乙/.test(onlyLogs) && !/K锁笔记/.test(onlyLogs), () => onlyLogs)

        /* 摘「日志」回缺省（为 sys 档让路） */
        nAt = listKinds().length
        await clickKind('日志')
        H.t('摘「日志」→ 无参回 6 行（恰一次）', await expectKind('摘日志落定', nAt, '', 6))

        /* 步③ 档②（eval 档②映射）：勾「机器」→ [sys] → 当次即 kind=sys（滞后病灶此处打出上一拍无参） */
        nAt = listKinds().length
        await clickKind('机器')
        H.t('档②锁：勾「机器」→ notes-list 实收 kind=sys 恰一次（当次档一致，零滞后）', await expectKind('勾机器落定', nAt, 'sys', 1))
        const onlySys = await rowTitles()
        H.t('档②锁：DOM 仅机器行（host kind 通道直达 sys 全库口径）', /K锁机器丁/.test(onlySys) && !/K锁笔记|K锁日志|K锁决策/.test(onlySys), () => onlySys)
        H.t('档②锁：命中计数 1 条随档一致', (await hitTxt()) === '命中 1 条', () => hitTxt())

        /* 步④ 档③（eval 档③映射）：加勾「笔记」→ [sys,note] 多选 → 当次即回无参（滞后病灶此处打出滞留 kind=sys）；
           DOM 口径：无参缺省列表不含 sys → 本地 kinds 过滤后仅 3 条笔记行（sys 行不混入多选档） */
        nAt = listKinds().length
        await clickKind('笔记')
        H.t('档③锁：加勾「笔记」多选 [sys,note] → 当次即无参恰一次（修复前滞留 kind=sys）', await expectKind('加勾笔记落定', nAt, '', 3))
        const multiTitles = await rowTitles()
        H.t('档③锁：DOM 仅三条笔记行（多选无参口径：缺省列表排除 sys，日志/决策按档滤除）',
          /K锁笔记一/.test(multiTitles) && /K锁笔记三/.test(multiTitles) && !/K锁机器|K锁日志|K锁决策/.test(multiTitles), () => multiTitles)

        /* 步⑤ 中间档：摘「机器」→ [note] → 当次即 kind=note */
        nAt = listKinds().length
        await clickKind('机器')
        H.t('档⑤锁：摘「机器」→ [note] 当次即 kind=note 恰一次', await expectKind('摘机器落定', nAt, 'note', 3))

        /* 步⑥ 档④（eval 档④映射）：摘「笔记」→ [] → 当次即回无参（修复前此处仍发 kind=note） */
        nAt = listKinds().length
        await clickKind('笔记')
        H.t('档④锁：摘「笔记」清空 → 当次即无参恰一次 + 6 行全量', await expectKind('摘笔记落定', nAt, '', 6))
        await h.page.click('.dsh-notes-fbtn-filter')   /* 收浮层 */

        /* 步⑦ 监听器兜底腿①（eval「监听器兜底 kinds=[] → 无参」映射）：编辑器删除 → doDelete loadNotes(true)
           + notifyNotesChanged → 监听器/📎徽标重拉——三连均走 filtersRef 镜像路径（无显式 kindsNow） */
        await h.page.locator('.dsh-notes-tree .dsh-notes-note-row', { hasText: 'K锁笔记一' }).first().click()
        await h.page.waitForSelector('.dsh-notes-meta-act.danger', { timeout: 8000 })
        const beforeDel1 = listKinds().length
        await h.page.click('.dsh-notes-meta-act.danger')
        await H.waitFor(h.page, '删除笔记一落定：三连 notes-list 全无参 + 列表回 5 行', async () =>
          listKinds().length === beforeDel1 + 3 && (await rowCnt()) === 5)
        H.t('兜底①锁：kinds=[] 删除触发三连重拉全无参（doDelete+监听器走 filtersRef 镜像；📎徽标恒 {} 注入口径）',
          JSON.stringify(listKinds().slice(beforeDel1)) === JSON.stringify(['', '', '']), () => 'delta=' + JSON.stringify(listKinds().slice(beforeDel1)))

        /* 步⑧ 档⑤（eval 档⑤映射）：复勾「笔记」→ 当次即 kind=note，2 行（一已删） */
        await h.page.click('.dsh-notes-fbtn-filter')
        await h.page.waitForSelector('.dsh-notes-fpop', { timeout: 8000 })
        nAt = listKinds().length
        await clickKind('笔记')
        H.t('档⑤锁：复勾「笔记」→ 当次即 kind=note + 2 行（删除已生效）', await expectKind('复勾笔记落定', nAt, 'note', 2))
        await h.page.click('.dsh-notes-fbtn-filter')

        /* 步⑨ 监听器兜底腿②（eval「监听器兜底 [note] → kind=note」映射） */
        await h.page.locator('.dsh-notes-tree .dsh-notes-note-row', { hasText: 'K锁笔记二' }).first().click()
        await h.page.waitForSelector('.dsh-notes-meta-act.danger', { timeout: 8000 })
        const beforeDel2 = listKinds().length
        await h.page.click('.dsh-notes-meta-act.danger')
        await H.waitFor(h.page, '删除笔记二落定：镜像两连 kind=note + 列表回 1 行', async () =>
          listKinds().length === beforeDel2 + 3 && (await rowCnt()) === 1)
        H.t('兜底②锁：[note] 档删除 → doDelete+监听器镜像路径重拉均 kind=note（📎徽标恒 {} 注入口径；外部 notes-changed 口径不变）',
          JSON.stringify(listKinds().slice(beforeDel2)) === JSON.stringify(['note', 'note', '']), () => 'delta=' + JSON.stringify(listKinds().slice(beforeDel2)))

        /* 收尾：全参数序列逐位相等（harness 录制 host.call 参数序列的最终形态锁——任何一档滞后/多发/漏发都会错位；
           序列尾部两连三元组 = 删除触发的 doDelete+监听器镜像档参数 + 📎徽标恒无参注入口径拉取） */
        const wantSeq = ['', '', 'log', '', 'sys', '', 'note', '', '', '', '', 'note', 'note', 'note', '']
        const gotSeq = listKinds()
        H.t('参数序列终锁：notes-list 实收 kind 序列逐位 = 缺省→日志→sys→多选无参→note→清空→删除三连→note→删除三连（徽标恒无参）',
          JSON.stringify(gotSeq) === JSON.stringify(wantSeq), () => '实得 ' + JSON.stringify(gotSeq))

        H.t('无 console error / pageerror', h.consoleErrors.length === 0, () => h.consoleErrors.slice(0, 3).join(' | '))
        await H.screenshot(h.page, '33-panel-kind-lag')
      })
    } finally { await h.close() }
  },
}
