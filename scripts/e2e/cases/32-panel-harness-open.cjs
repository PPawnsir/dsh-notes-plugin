'use strict'
/* 0.4.7-D1 用例㉜：面板 harness proof-of-life ①——真机打开渲染树 + harness 自证 + 桩未接通必红锁。
 * 覆盖盲区：既有 231 条全打 app 页（DOM 态），client 浮动面板（React）此前零 e2e 覆盖。
 * 自证（防假绿）三层：①slots 注册面含 dsh-notes-panel（bundle 真装配，非空容器假渲染）；
 * ②rpcCalls 实测 notes-css/notes-list 真走拦截（桩接通证据）；③breakRpc 断桩页同套断言必红（负向锁）。 */
const { mountPanel } = require('../panel-harness.cjs')

module.exports = {
  name: '㉜ 面板 harness：真机开板渲染树 + 桩接通自证 + 断桩必红负向锁',
  async run({ browser, H }) {
    /* ===== A. 健康桩：开板渲染树 ===== */
    const h = await mountPanel(browser)
    try {
      await H.step(h.page, '32-panel-harness-open', async () => {
        const reg = await h.registered()
        H.t('桩接通①：slots 注册面含主面板与头部入口（bundle 真装配）',
          !!(reg && (reg['shell.overlay'] || []).indexOf('dsh-notes-panel') >= 0
            && (reg['conversation.session.header.actions'] || []).indexOf('dsh-notes-btn') >= 0),
          () => JSON.stringify(reg))
        H.t('桩接通②：装载期 notes-css 真走拦截（含样式下发）',
          h.rpcCalls.some(c => c.method === 'notes-css'),
          () => 'rpcCalls=' + h.rpcCalls.map(c => c.method).join(','))

        await h.openPanel()
        /* 面板骨架：浮动层 + 两栏 + 树容器 */
        await h.page.waitForSelector('.dsh-notes-floating .dsh-notes-tree', { timeout: 10000 })
        H.t('面板 DOM 骨架渲染（.dsh-notes-floating + .dsh-notes-tree）', true)
        /* 数据面：mock 种子进树（默认种子 2 笔记 + 1 日志，日志夹缺省展开） */
        await H.waitFor(h.page, '树中出现种子笔记 A/B 与日志条目', async p => {
          const txt = await p.evaluate(() => document.querySelector('.dsh-notes-tree').textContent)
          return txt.indexOf('e2e 种子笔记 A') >= 0 && txt.indexOf('e2e 种子笔记 B') >= 0 && txt.indexOf('e2e 日志条目') >= 0
        })
        H.t('开板后树渲染 mock 种子（2 笔记 + 1 日志）', true)
        /* 桩接通③：开板取数 notes-list 实走拦截（无参数 = 缺省口径） */
        H.t('桩接通③：开板 notes-list 真走拦截且参数为缺省口径',
          h.rpcCalls.some(c => c.method === 'notes-list' && !(c.args && c.args.kind)),
          () => 'rpcCalls=' + h.rpcCalls.map(c => c.method + JSON.stringify(c.args || {})).join(','))
        /* brand 计数 = 3（同权口径：日志计入） */
        const cnt = await h.page.evaluate(() => {
          const el = document.querySelector('.dsh-notes-brand-cnt')
          return el ? el.textContent.trim() : '(missing)'
        })
        H.t('brand 计数 = 3 条（日志同权口径）', cnt === '3 条', () => '实得 ' + cnt)
        /* 无错误条（健康桩零 RPC 失败） */
        H.t('健康桩无错误条（.dsh-notes-error 缺席）',
          (await h.page.evaluate(() => !!document.querySelector('.dsh-notes-error'))) === false)
        const hErrs = await h.harnessErrors()
        H.t('harness 装配零错误（__panelHarness.errors 空）', hErrs.length === 0, () => hErrs.slice(0, 3).join(' | '))
        H.t('无 console error / pageerror', h.consoleErrors.length === 0, () => h.consoleErrors.slice(0, 3).join(' | '))
        await H.screenshot(h.page, '32-panel-harness-open')
      })
    } finally { await h.close() }

    /* ===== B. 断桩负向锁：桩未接通时同套断言必红（防假绿） ===== */
    const hb = await mountPanel(browser, { breakRpc: true })
    try {
      await H.step(hb.page, '32-panel-harness-broken', async () => {
        await hb.page.click('.dsh-notes-hdr-btn')
        await hb.page.waitForSelector('.dsh-notes-floating', { timeout: 10000 })
        /* 断桩下取数必败 → 错误条上浮 + 种子绝不进树；若此两条反而绿，说明 A 段断言是假绿 */
        await H.waitFor(hb.page, '断桩页错误条出现', async p =>
          p.evaluate(() => !!document.querySelector('.dsh-notes-error')))
        H.t('断桩页：错误条必现（取数失败上浮）', true)
        const hasSeed = await hb.page.evaluate(() => {
          const treeEl = document.querySelector('.dsh-notes-tree')
          return treeEl ? treeEl.textContent.indexOf('e2e 种子笔记 A') >= 0 : false
        })
        H.t('断桩页：种子笔记不进树（A 段树断言在断桩下必红）', !hasSeed)
        H.t('断桩页：notes-list 有尝试、零应答（拦截面实证断桩）',
          hb.rpcAttempts.some(c => c.method === 'notes-list') && !hb.rpcCalls.some(c => c.method === 'notes-list'),
          () => 'attempts=' + hb.rpcAttempts.map(c => c.method).join(','))
      })
    } finally { await hb.close() }
  },
}
