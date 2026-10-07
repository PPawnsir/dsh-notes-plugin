'use strict'
/* 0.4.5-G 用例㉔（notes-045-conflict-check）：注入管理面板「约定体检」——
 * 链路锁：约定区按钮 → notes-conflict-check（mock 提名前两条活跃约定为疑似冲突对）→ 面板内联结果区（不叠 modal：单一 #modalHost 结构锁）
 *   →「保留两者」= 会话内 dismiss 零写入（status 不动）→ 重跑再提名（dismiss 不持久）→「标 B 已取代」= notes-update status='superseded'（注入不动）+ 行移除
 *   → 重跑收敛（mock：superseded 不再参与提名——若仍有 ≥2 条活跃约定则提名对不含被取代者，否则空态提示）。
 * 隔离纪律：用例自带新建两条约定，但 e2e 各用例共享 mock host 状态（种子笔记 A 已被用例⑪置为约定档）——
 *   提名对的端点不确定，断言一律从 DOM 实读 a/b 标题再核验（顺序无关）。 */
module.exports = {
  name: '㉔ 约定体检：内联结果区提名对 + 保留两者零副作用 / 标已取代落 status + 重跑收敛',
  async run({ base, browser, H }) {
    const page = await H.newPage(browser, base)
    /* 0.4.6-E：「约定」档新增二次确认闸（meta.convInjectConfirm）——本用例走确认通过路径（Playwright 缺省自动 dismiss 对话框，须显式 accept） */
    page.on('dialog', d => { d.accept().catch(() => {}) })
    try {
      await H.step(page, '24-conflict-check', async () => {
        /* 隔离造数：两条 off 态笔记 → 逐条切「约定」档 */
        await H.createNoteViaUI(page, 'e2e 体检约定甲', '甲：日志默认隐身不参与检索')
        await H.createNoteViaUI(page, 'e2e 体检约定乙', '乙：日志同权可见可搜（与甲矛盾）')
        for (const title of ['e2e 体检约定甲', 'e2e 体检约定乙']) {
          await page.click('#tree .note-row:has-text("' + title + '")')
          await page.waitForSelector('#mRole', { timeout: 8000 })
          await page.click('#mRole .seg[data-role="convention"]')
          await H.waitFor(page, '树行出现注入徽章（' + title + ' 翻约定档）', async p =>
            p.evaluate(t2 => {
              var rows = document.querySelectorAll('#tree .note-row')
              for (var i = 0; i < rows.length; i++) {
                if (rows[i].textContent.indexOf(t2) >= 0) return rows[i].querySelectorAll('use[href="#i-bolt"]').length === 1
              }
              return false
            }, title))
        }
        /* 打开注入管理面板 */
        await page.click('#btnSettings')
        await page.waitForSelector('#setInjectManager', { timeout: 8000 })
        await page.click('#setInjectManager')
        await page.waitForSelector('#injMgrChips .injmgr-chip', { timeout: 8000 })
        /* 内联展开区结构锁：约定体检区在唯一 modal 内（不叠第二层 modal——#modalHost 单 mask 结构断言） */
        await page.waitForSelector('#modal #injConflictHost .conflict-sec', { timeout: 8000 })
        H.t('约定体检区内联于注入管理面板（#modal #injConflictHost .conflict-sec）', true)
        const maskCount = await page.evaluate(() => document.querySelectorAll('#modalHost .mask').length)
        H.t('modal 不叠 modal：#modalHost 内恰一层 mask', maskCount === 1, () => '实得 mask 层数 ' + maskCount)
        /* DOM 实读提名对（共享 mock 状态，端点不确定——顺序无关断言） */
        const readPair = () => page.evaluate(() => {
          var row = document.querySelector('#injConflictHost .conflict-row')
          if (!row) return null
          var tis = row.querySelectorAll('.conflict-ti')
          return {
            a: tis[0] ? tis[0].textContent : '', b: tis[1] ? tis[1].textContent : '',
            badge: row.querySelector('.conflict-badge').textContent,
            acts: Array.prototype.map.call(row.querySelectorAll('.conflict-act'), function (b) { return b.getAttribute('data-act') }),
          }
        })
        const statusOf = (titles) => page.evaluate((ts) =>
          fetch('/dsh-notes', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ method: 'notes-list', args: {} }) })
            .then(r => r.json())
            .then(res => {
              var m = {}
              res.notes.forEach(n => { if (ts.indexOf(n.title) >= 0) m[n.title] = n.status + '/' + (n.inject ? 'inject' : 'off') })
              return m
            }), titles)
        /* 跑体检 → mock 提名疑似冲突对（结构断言：徽章/双标题/三动作） */
        await page.click('#injConflictRun')
        await page.waitForSelector('#injConflictHost .conflict-row', { timeout: 8000 })
        const p0 = await readPair()
        H.t('提名行：徽章=疑似冲突 + A⇄B 双标题相异 + 三动作（supA/supB/keep）',
          !!p0 && p0.badge.indexOf('疑似冲突') >= 0 && !!p0.a && !!p0.b && p0.a !== p0.b && p0.acts.join(',') === 'supA,supB,keep',
          () => JSON.stringify(p0))
        /* 「保留两者」= 会话内 dismiss：行移除 + 零写入（提名两端 status/inject 均不动） */
        await page.click('#injConflictHost .conflict-act[data-act="keep"]')
        await H.waitFor(page, '保留两者后提名行移除', async p => p.evaluate(() => !document.querySelector('#injConflictHost .conflict-row')))
        const stK = await statusOf([p0.a, p0.b])
        H.t('保留两者零副作用：提名两端 status 均仍 active 且注入不动（零写入）',
          stK[p0.a] === 'active/inject' && stK[p0.b] === 'active/inject', () => JSON.stringify(stK))
        /* 重跑再提名（dismiss 不持久）→ 实读 B 端标题 →「标 B 已取代」 */
        await page.click('#injConflictRun')
        await page.waitForSelector('#injConflictHost .conflict-row', { timeout: 8000 })
        const p1 = await readPair()
        H.t('重跑再提名：dismiss 不持久，提名行重现', !!p1 && !!p1.b)
        await page.click('#injConflictHost .conflict-act[data-act="supB"]')
        await H.waitFor(page, '标 B 已取代后提名行移除', async p => p.evaluate(() => !document.querySelector('#injConflictHost .conflict-row')))
        const stS = await statusOf([p1.a, p1.b])
        H.t('标 B 已取代：B 端 status=superseded 且注入不动（inject 仍开），A 端不受影响',
          stS[p1.b] === 'superseded/inject' && stS[p1.a] === 'active/inject', () => JSON.stringify(stS))
        /* 重跑收敛：superseded 不再参与提名——仍有 ≥2 条活跃约定则新提名对不含 B 端，否则空态提示 */
        await page.click('#injConflictRun')
        await H.waitFor(page, '裁决后重跑出新提名或空态', async p =>
          p.evaluate(() => {
            var h = document.querySelector('#injConflictHost')
            return h && (h.querySelector('.conflict-row') || h.textContent.indexOf('未发现疑似冲突或取代') >= 0)
          }))
        const p2 = await readPair()
        if (p2) H.t('裁决后重跑：新提名对不含已被取代的 B 端（superseded 收敛）', p2.a !== p1.b && p2.b !== p1.b, () => JSON.stringify(p2))
        else H.t('裁决后重跑：活跃约定 <2 → 空态提示（未发现疑似冲突或取代的约定对）', true)
        await H.screenshot(page, '24-conflict-check')
      })
    } finally { await page.context().close() }
  },
}
