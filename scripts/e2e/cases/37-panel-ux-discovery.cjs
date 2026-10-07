'use strict'
/* 0.4.7-D2 用例㊲（notes-047-panel-e2e-migrate）：C 卡（check 节 95）面板侧概念引导/建议按钮断言的真机迁移。
 * （app 页侧同款链路既有用例㉘承接；本用例全部打 client React 面板/会话头部，走发布产物 lib/client.js。）
 *
 * == 迁移映射（原断言 → 本用例真机锁；退役/保留裁决见 check/sections/95-ux-discovery.cjs 各块注）==
 *   节95 t①「使用说明气泡首屏五概念节 + 拼接产物锚」
 *     → 步④：真机开气泡——h5 标题 + 五概念 li 逐字（真 zh 字典渲染）+ more 行 + 首屏序位（概念块在操作清单前，DOM compareDocumentPosition 锁）；
 *       产物锚由 harness 装载 lib/client.js 行为覆盖 + check 可复现断言兜底 → 原 t① 退役
 *   节95 t②client「标题栏『建议』按钮 + badge 切片订阅 + 打开/变更双触发防抖刷新」
 *     → 步②：徽标真机点亮 = notes-suggest 固定集六段合计 3 + tooltip 字典文案 + 点击开建议框；
 *       步③：fixture 六段齐备 → 关板重开（open 触发器）→ 徽标 12 + 建议框六段计数逐段 DOM 锁
 *       （等价原「计数一致 eval：suggestPendingCount = 六段合计 12」——真机走 真RPC→真计数函数→真徽标 全链）；
 *       保留：badge:-1 初值/失败保旧值/1200ms 防抖/样式四个内部态源锚（真机不经济，见节95 t② 注）
 *   节95 t②b「建议框底栏『约定体检…』→ 关建议框开注入管理」
 *     → 步②尾：真机点击链——建议框消失 + 注入管理 modal 出现 + 体检区在案（modal 不叠 modal）
 *   节95 t④「📎 tooltip 数字语义写明」
 *     → 步①：会话头部 📎3 徽标真机渲染（约定 2 + 挂载资料 1）+ data-tooltip 含「约定 2 · 资料 1」「徽标数字 = 两者合计」
 *       + 点开浮层双区计数锁；字典逐字锚保留（节95 t④ 原样）
 *   节95 t⑤「面板编辑器『整理』『派发』在位锁定 + meta-act 窄宽 flex-shrink:0 根修」
 *     → 步⑤：编辑器 meta 区两按钮 DOM 在位 + computed style flexShrink:0/nowrap（强于 CSS 源文本锚）+
 *       真机点击：整理 → 追加指令弹卡、派发 → 派发弹窗（接线锁）
 *   节95 t①b「client 树空态概念指向」
 *     → mount B：零笔记空态真机渲染 .dsh-notes-empty-concept + 原 emptySub 引导行保留（叠加不替换）
 *   保留不迁：节95 t③「@ 空态 mention.empty eval」——@ 候选源挂在宿主 inputTriggers 服务（输入框侧），
 *     harness ctx 契约不含此服务（面板内无 @ 触发面），真机够不到 → eval 原样保留（节95 t③ 注）。 */
const { mountPanel } = require('../panel-harness.cjs')

module.exports = {
  name: '㊲ 面板 UX 发现性真机锁：📎徽标语义 + 建议徽标六段合计 + 体检直达 + 概念引导首屏 + 整理/派发接线 + 空态概念行',
  async run({ browser, H }) {
    /* ===== mount A：主链路 ===== */
    const h = await mountPanel(browser, {
      seed(state) {
        /* 📎 徽标数据源：2 约定（inject=true + convention）+ 1 资料笔记被注入索引 §1 挂载行引用 */
        state.notes.push(
          { id: 'c-conv-1', title: 'C锁约定一', body: '约定一正文', topic: '', kind: 'note', tags: [], status: 'active', pinned: false, inject: true, injectRole: 'convention', injectTo: [], recall: true, folder: '', useCount: 0, contractType: '', createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(), deleted: false },
          { id: 'c-conv-2', title: 'C锁约定二', body: '约定二正文', topic: '', kind: 'note', tags: [], status: 'active', pinned: false, inject: true, injectRole: 'convention', injectTo: [], recall: true, folder: '', useCount: 0, contractType: '', createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(), deleted: false },
          { id: 'c-ref-1', title: 'C锁资料一', body: '资料一正文', topic: '', kind: 'note', tags: [], status: 'active', pinned: false, inject: true, injectRole: 'reference', injectTo: [], recall: true, folder: '', useCount: 0, contractType: '', createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(), deleted: false })
        state._mounts = { 'c-ref-1': '断言面板样式时查我' }   /* notes-mount-list 挂载行数据源（server.cjs 状态化登记面） */
      },
    })
    const panel = () => h.page.locator('.dsh-notes-floating')
    try {
      await H.step(h.page, '37-panel-ux-discovery', async () => {
        await h.openPanel()
        await h.page.waitForSelector('.dsh-notes-floating .dsh-notes-tree', { timeout: 10000 })

        /* 步① 📎 徽标（节95 t④ 真机面）：📎3 = 约定 2 + 资料 1；tooltip 数字语义写明；浮层双区计数 */
        await H.waitFor(h.page, '📎 徽标渲染（约定 2 + 资料 1 = 3）', async p =>
          p.evaluate(() => {
            const n = document.querySelector('.dsh-notes-injbadge-n')
            return !!n && n.textContent.trim() === '3'
          }))
        H.t('📎 会话头部徽标 📎3（约定 2 + 挂载资料 1 = 两者合计）', true)
        const tip = await h.page.evaluate(() => {
          const b = document.querySelector('.dsh-notes-injbadge-btn')
          return b ? (b.getAttribute('data-tooltip') || '') : '(missing)'
        })
        H.t('📎 tooltip 数字语义写明：「约定 2 · 资料 1」+「徽标数字 = 两者合计」',
          tip.indexOf('约定 2 · 资料 1') >= 0 && tip.indexOf('徽标数字 = 两者合计') >= 0, () => tip)
        await h.page.click('.dsh-notes-injbadge-btn')
        await h.page.waitForSelector('.dsh-notes-injbadge-pop', { timeout: 8000 })
        const popTxt = await h.page.evaluate(() => document.querySelector('.dsh-notes-injbadge-pop').textContent)
        H.t('📎 浮层双区：「约定 · 须遵守（2）」+「挂载资料 · 按需取用（1）」+ 三行条目',
          popTxt.indexOf('约定 · 须遵守（2）') >= 0 && popTxt.indexOf('挂载资料 · 按需取用（1）') >= 0
          && popTxt.indexOf('C锁约定一') >= 0 && popTxt.indexOf('C锁资料一') >= 0, () => popTxt.slice(0, 120))
        /* 关浮层用「点外关闭」（📎 浮层在面板 Esc 分层栈外，裸 Esc 会穿透到面板关板分支——此处点品牌区空白） */
        await h.page.click('.dsh-notes-brand')
        await H.waitFor(h.page, '📎 浮层已关', async p => p.evaluate(() => !document.querySelector('.dsh-notes-injbadge-pop')))

        /* 步② 建议徽标（节95 t②client 真机面）：开板防抖刷新 → 徽标 3（mock 固定集 stale 2 + orphan 1）；点击开建议框 */
        await H.waitFor(h.page, '标题栏「建议」徽标点亮 = 3（开板触发 + 1.2s 防抖收口）', async p =>
          p.evaluate(() => {
            const el = document.querySelector('.dsh-notes-titlebar .dsh-notes-tcnt')
            return !!el && el.textContent.trim() === '3'
          }), 10000)
        H.t('「建议」徽标计数 = 3（notes-suggest 固定集六段合计口径，真 RPC→真计数函数→真徽标）', true)
        const sugTip = await h.page.evaluate(() => {
          const btns = Array.from(document.querySelectorAll('.dsh-notes-titlebar-btn'))
          const b = btns.find(x => x.textContent.indexOf('建议') >= 0)
          return b ? (b.getAttribute('data-tooltip') || '') : '(missing)'
        })
        H.t('徽标计数 tooltip 走 topbar.suggestTipN（含条数 3 + 只提名 + 体检入口注记）',
          sugTip.indexOf('3') >= 0 && sugTip.indexOf('只提名不执行') >= 0 && sugTip.indexOf('约定体检') >= 0, () => sugTip)
        await panel().locator('.dsh-notes-titlebar-btn', { hasText: '建议' }).click()
        await h.page.waitForSelector('.dsh-notes-suggest-modal', { timeout: 8000 })
        const modalTxt = await h.page.evaluate(() => document.querySelector('.dsh-notes-suggest-modal').textContent)
        H.t('建议框打开：过期未引用 2 条 + 可能无用 1 条（与徽标同一响应同口径）',
          modalTxt.indexOf('过期未引用') >= 0 && modalTxt.indexOf('2 条') >= 0 && modalTxt.indexOf('可能无用') >= 0 && modalTxt.indexOf('1 条') >= 0,
          () => modalTxt.slice(0, 140))

        /* 步②尾 体检直达（节95 t②b 真机面）：底栏「约定体检…」→ 关建议框 + 开注入管理（modal 不叠 modal）+ 体检区在案 */
        await panel().locator('.dsh-notes-suggest-modal .dsh-notes-dispatch-cancel', { hasText: '约定体检' }).click()
        await h.page.waitForSelector('.dsh-notes-injmgr-modal', { timeout: 8000 })
        await H.waitFor(h.page, '注入管理体检区在案', async p =>
          p.evaluate(() => !!document.querySelector('.dsh-notes-injmgr-modal .dsh-notes-conflict-sec')))
        const modalStack = await h.page.evaluate(() => ({
          suggest: !!document.querySelector('.dsh-notes-suggest-modal'),
          injmgr: !!document.querySelector('.dsh-notes-injmgr-modal'),
          masks: document.querySelectorAll('.dsh-notes-floating .dsh-notes-settings-mask').length,
        }))
        H.t('「约定体检…」直达：建议框已关 + 注入管理开 + 体检区在案（modal 不叠 modal：面板内恰一层 mask）',
          !modalStack.suggest && modalStack.injmgr && modalStack.masks === 1, () => JSON.stringify(modalStack))
        await panel().locator('.dsh-notes-injmgr-modal .dsh-notes-dispatch-cancel', { hasText: '关闭' }).click()
        await H.waitFor(h.page, '注入管理已关', async p => p.evaluate(() => !document.querySelector('.dsh-notes-injmgr-modal')))

        /* 步③ 六段合计 = 12 真机锁（等价节95 退役的 suggestPendingCount 六段 eval）：
           fixture 覆写 → 关板重开（open 触发器真路径）→ 徽标 12 → 建议框六段计数逐段锁 */
        h.state._suggestFixture = {
          archiveCandidates: [
            { sessionId: 's1', title: '速记组甲', members: [{}, {}], dateSpan: { from: '2026-09-01', to: '2026-09-02' }, totalBytes: 100, totalUseCount: 0 },
            { sessionId: 's2', title: '速记组乙', members: [{}, {}, {}], dateSpan: { from: '2026-09-03', to: '2026-09-03' }, totalBytes: 200, totalUseCount: 1 }],
          staleCandidates: [
            { id: 'fx-s1', title: '过期甲', topic: '', staleDays: 120 }, { id: 'fx-s2', title: '过期乙', topic: '', staleDays: 100 }, { id: 'fx-s3', title: '过期丙', topic: '', staleDays: 95 }],
          orphanCandidates: [{ id: 'fx-o1', title: '孤儿甲', topic: '', updatedAt: new Date().toISOString() }],
          logHygieneCandidates: {
            weekly: [{ key: 'w1', title: '周聚合甲', members: [] }],
            monthly: [{ key: 'm1', title: '月聚合甲', members: [] }, { key: 'm2', title: '月聚合乙', members: [] }],
          },
          zeroRefMountCandidates: [{ id: 'fx-z1', title: '零引用甲', topic: '', when: '何时' }],
          hotUnmountedCandidates: [{ id: 'fx-h1', title: '高频甲', topic: '', hits: 5 }, { id: 'fx-h2', title: '高频乙', topic: '', hits: 3 }],
        }
        await panel().locator('.dsh-notes-titlebar-btn', { hasText: '×' }).click()   /* 关板 */
        await H.waitFor(h.page, '面板已关', async p => p.evaluate(() => !document.querySelector('.dsh-notes-floating')))
        await h.openPanel()   /* 重开 → open 触发器 → 防抖刷新徽标 */
        await h.page.waitForSelector('.dsh-notes-floating .dsh-notes-tree', { timeout: 10000 })
        await H.waitFor(h.page, '六段 fixture 徽标点亮 = 12', async p =>
          p.evaluate(() => {
            const el = document.querySelector('.dsh-notes-titlebar .dsh-notes-tcnt')
            return !!el && el.textContent.trim() === '12'
          }), 10000)
        H.t('六段合计真机锁：徽标 = 12（2 速记组 + 3 过期 + 1 孤儿 + 3 日志卫生组 + 1 零引用 + 2 高频）', true)
        await panel().locator('.dsh-notes-titlebar-btn', { hasText: '建议' }).click()
        await h.page.waitForSelector('.dsh-notes-suggest-modal', { timeout: 8000 })
        await H.waitFor(h.page, '建议框六段渲染落定（高频段出现）', async p =>
          p.evaluate(() => { const el = document.querySelector('.dsh-notes-suggest-modal'); return !!el && el.textContent.indexOf('高频取用未挂载') >= 0 }))
        const secTxts = await h.page.evaluate(() =>
          Array.from(document.querySelectorAll('.dsh-notes-suggest-modal .dsh-notes-suggest-sec')).map(el => el.textContent))
        H.t('建议框六段计数逐段一致（2 组/3 条/1 条/3 组/1 条/2 条，与徽标 12 同一响应）',
          secTxts.length === 6
          && secTxts[0].indexOf('2 组') >= 0 && secTxts[1].indexOf('3 条') >= 0 && secTxts[2].indexOf('1 条') >= 0
          && secTxts[3].indexOf('3 组') >= 0 && secTxts[4].indexOf('1 条') >= 0 && secTxts[5].indexOf('2 条') >= 0,
          () => JSON.stringify(secTxts.map(s => s.slice(0, 30))))
        await panel().locator('.dsh-notes-suggest-modal .dsh-notes-dispatch-cancel', { hasText: '关闭' }).click()
        await H.waitFor(h.page, '建议框已关', async p => p.evaluate(() => !document.querySelector('.dsh-notes-suggest-modal')))

        /* 步④ 概念引导（节95 t① 真机面）：标题栏 ? → 气泡首屏「核心概念 30 秒」五概念 + more 行 + 序位在操作清单前 */
        await panel().locator('.dsh-notes-titlebar-btn', { hasText: '?' }).click()
        await h.page.waitForSelector('.dsh-notes-help-bubble .dsh-notes-help-concepts', { timeout: 8000 })
        const concepts = await h.page.evaluate(() => {
          const box = document.querySelector('.dsh-notes-help-concepts')
          return {
            h5: (box.querySelector('h5') || {}).textContent || '',
            lis: Array.from(box.querySelectorAll('li')).map(el => el.textContent),
            more: (box.querySelector('.dsh-notes-help-concepts-more') || {}).textContent || '',
            bubbleTxt: (document.querySelector('.dsh-notes-help-bubble') || {}).textContent || '',
          }
        })
        const WANT_LIS = [
          '约定：每次对话都注入、Agent 必须遵守——写下规则，AI 会一直照做',
          '资料：注入后 Agent 按需取用的参考——不强制遵守，需要时才读',
          '挂载：把笔记登记进注入目录（一行索引 +「何时查我」）——Agent 先看到索引，需要全文再调取',
          '派发：把待办笔记派给指定会话执行——完成后回执自动闭环',
          '隐藏：笔记从列表/树隐身降噪——搜索和跳转仍能找到，不是删除',
        ]
        H.t('概念节标题「核心概念 30 秒」+ 五概念 li 逐字（真 zh 字典渲染）', concepts.h5 === '核心概念 30 秒' && JSON.stringify(concepts.lis) === JSON.stringify(WANT_LIS), () => JSON.stringify(concepts.lis))
        H.t('概念节 more 行指向设置卡完整版', concepts.more.indexOf('概念速览') >= 0, () => concepts.more)
        H.t('概念节首屏序位：在标题后、操作清单（点侧栏「新建」）之前',
          concepts.bubbleTxt.indexOf('核心概念 30 秒') > concepts.bubbleTxt.indexOf('使用说明')
          && concepts.bubbleTxt.indexOf('核心概念 30 秒') < concepts.bubbleTxt.indexOf('点侧栏「新建」'), () => concepts.bubbleTxt.slice(0, 60))
        await panel().locator('.dsh-notes-help-close').click()

        /* 步⑤ 编辑器「整理」「派发」（节95 t⑤ 真机面）：DOM 在位 + 窄宽 computed style + 点击接线 */
        await h.page.locator('.dsh-notes-tree .dsh-notes-note-row', { hasText: 'e2e 种子笔记 A' }).first().click()
        await h.page.waitForSelector('.dsh-notes-meta-act.dsh-notes-organize-btn', { timeout: 8000 })
        const metaInfo = await h.page.evaluate(() => {
          const org = document.querySelector('.dsh-notes-meta-act.dsh-notes-organize-btn')
          const disp = Array.from(document.querySelectorAll('.dsh-notes-meta-act')).find(x => x.textContent.indexOf('派发') >= 0)
          const cs = org ? getComputedStyle(org) : null
          return { org: !!org, orgTxt: org ? org.textContent.trim() : '', disp: !!disp, flexShrink: cs ? cs.flexShrink : '', nowrap: cs ? cs.whiteSpace : '' }
        })
        H.t('编辑器 meta 动作区「整理」「派发」在位（真 DOM）', metaInfo.org && metaInfo.disp, () => JSON.stringify(metaInfo))
        H.t('meta-act 窄宽根修真机锁：computed flex-shrink:0 + white-space:nowrap（强于 CSS 源文本锚）',
          metaInfo.flexShrink === '0' && metaInfo.nowrap === 'nowrap', () => 'flexShrink=' + metaInfo.flexShrink + ' whiteSpace=' + metaInfo.nowrap)
        await h.page.click('.dsh-notes-meta-act.dsh-notes-organize-btn')
        await H.waitFor(h.page, '整理追加指令弹卡打开', async p =>
          p.evaluate(() => { const m = document.querySelector('.dsh-notes-settings-modal'); return !!m && m.textContent.indexOf('AI 整理 · 追加指令') >= 0 }))
        H.t('「整理」点击接线：追加指令弹卡打开（openOrganizeInstruct 链路）', true)
        await h.page.click('.dsh-notes-settings-mask', { position: { x: 6, y: 6 } })   /* 点 mask 空白关闭（裸 Esc 会穿透关板） */
        await H.waitFor(h.page, '整理弹卡已关', async p => p.evaluate(() => !document.querySelector('.dsh-notes-settings-modal')))
        await h.page.locator('.dsh-notes-meta-act', { hasText: '派发' }).first().click()
        await h.page.waitForSelector('.dsh-notes-dispatch-modal', { timeout: 8000 })
        H.t('「派发」点击接线：派发弹窗打开（openDispatch 链路）', true)
        await h.page.click('.dsh-notes-dispatch-mask', { position: { x: 6, y: 6 } })   /* 点 mask 空白关闭 */
        await H.waitFor(h.page, '派发弹窗已关', async p => p.evaluate(() => !document.querySelector('.dsh-notes-dispatch-modal')))

        H.t('全程无 console error / pageerror', h.consoleErrors.length === 0, () => h.consoleErrors.slice(0, 3).join(' | '))
        await H.screenshot(h.page, '37-panel-ux-discovery')
      })
    } finally { await h.close() }

    /* ===== mount B：零笔记空态概念指向（节95 t①b client 面真机迁移）===== */
    const hB = await mountPanel(browser, { seed(state) { state.notes.length = 0 } })
    try {
      await H.step(hB.page, '37-panel-ux-discovery-empty', async () => {
        await hB.openPanel()
        await H.waitFor(hB.page, '空态概念指向行渲染', async p =>
          p.evaluate(() => {
            const el = document.querySelector('.dsh-notes-tree .dsh-notes-empty-concept')
            return !!el && el.textContent.indexOf('30 秒看懂五个核心概念') >= 0
          }))
        const emptyInfo = await hB.page.evaluate(() => {
          const box = document.querySelector('.dsh-notes-tree .dsh-notes-empty-state')
          return box ? box.textContent : '(missing)'
        })
        H.t('空态首笔记引导：概念指向行（点标题栏 ? 30 秒看懂五个核心概念）+ 原空态引导行保留（叠加不替换）',
          emptyInfo.indexOf('30 秒看懂五个核心概念') >= 0 && emptyInfo.indexOf('点侧栏「新建」输入标题') >= 0, () => emptyInfo.slice(0, 120))
        H.t('B 全程无 console error / pageerror', hB.consoleErrors.length === 0, () => hB.consoleErrors.slice(0, 3).join(' | '))
        await H.screenshot(hB.page, '37-panel-ux-discovery-empty')
      })
    } finally { await hB.close() }
  },
}
