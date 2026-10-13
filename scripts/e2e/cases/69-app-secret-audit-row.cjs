'use strict';
/* 文档安全二期（notes-061-docsec-hygiene 池#17）app 端设置卡「机密读取记录」查看入口行为级：
 * ① 设置卡「数据与存储」组渲染：secretaudit 行在案（紧随 secretdetect 行之后）+ 「查看」钮在案；
 * ② 点击「查看」→ 展开只读列表：mock 缓冲缺省空 → 空态「暂无读取记录」+ 钮文案翻转「收起」；
 * ③ state.secretAudit 推两条 → 收起再展开（每次展开重新拉取）→ 列表渲染两条（倒序=最新在前；
 *   行 = 时间 · 笔记标题 · 会话 · N 处机密区）→ 再点「收起」列表收拢、钮文案回「查看」。
 * 隔离纪律：纯 UI 演习 + mock state 直推造数（e2e 无 note_get 工具面——缓冲入账行为级由 check 节 136 看守），
 *   finally 关 context；收尾清空 state.secretAudit（共享态礼貌）。 */
module.exports = {
  name: '文档安全二期：设置卡「机密读取记录」查看入口（空态 → 双条渲染 → 收起）——app',
  async run({ base, browser, H, state }) {
    const page = await H.newPage(browser, base)
    try {
      await H.step(page, '69-app-secret-audit-row', async () => {
        /* ===== ① 行在案：data 组 secretaudit 紧随 secretdetect ===== */
        await page.click('#btnSettings')
        await page.waitForSelector('#setBody .set-row', { timeout: 8000 })
        await H.waitFor(page, '设置卡落定（LLM 区渲染）', async p => p.evaluate(() => !!document.querySelector('#setOrgMax')))
        const rowInfo = await page.evaluate(() => {
          const g = document.querySelector('#setBody .set-group[data-g="data"]')
          if (!g) return { inDataGroup: false }
          const rows = Array.prototype.slice.call(g.querySelectorAll('.set-row[data-sec]')).map(function (el) { return el.getAttribute('data-sec') })
          return {
            inDataGroup: true,
            rows: rows,
            auditIdx: rows.indexOf('secretaudit'),
            detectIdx: rows.indexOf('secretdetect'),
            btn: !!document.querySelector('#setSecretAudit'),
            btnText: (document.querySelector('#setSecretAudit') || {}).textContent || '',
            listHidden: (function () { var b = document.querySelector('#setSecretAuditBody'); return !!(b && b.style.display === 'none') })(),
          }
        })
        H.t('① 设置卡「数据与存储」组渲染：secretaudit 行在案且紧随 secretdetect（池#17 入驻位）+ 查看钮缺省文案 + 列表壳初态隐藏',
          rowInfo.inDataGroup && rowInfo.auditIdx === rowInfo.detectIdx + 1 && rowInfo.btn && rowInfo.btnText === '查看' && rowInfo.listHidden === true,
          () => JSON.stringify(rowInfo))

        /* ===== ② 空态：点击「查看」→ 展开 → 「暂无读取记录」+ 钮翻转「收起」 ===== */
        await page.click('#setSecretAudit')
        await H.waitFor(page, '展开 → 空态「暂无读取记录」（mock 缓冲缺省空）+ 钮翻转「收起」', async p => p.evaluate(() => {
          var body = document.querySelector('#setSecretAuditBody')
          var btn = document.querySelector('#setSecretAudit')
          return !!(body && body.style.display !== 'none' && body.textContent.indexOf('暂无读取记录') >= 0 && btn && btn.textContent === '收起')
        }))
        H.t('② 点击「查看」→ 展开只读列表：空态「暂无读取记录」+ 钮文案翻转「收起」（notes-secret-audit 真接通 app RPC 链）', true)

        /* ===== ③ 非空渲染：推两条（倒序）→ 收起再展开 → 两行（时间·标题·会话·机密区数）→ 收起回拢 ===== */
        state.secretAudit.push(
          { at: '2026-10-13T02:00:00.000Z', note: 'n-e2e-audit-b', title: '69 审计条目乙', session: 'session-bb22cc33-demo', spans: 1 },
          { at: '2026-10-13T03:00:00.000Z', note: 'n-e2e-audit-a', title: '69 审计条目甲', session: 'session-aa11bb22-demo', spans: 2 })
        state.secretAudit.reverse()   /* host 口径：倒序（最新在前）——甲(03:00) 应渲染在乙(02:00) 之前 */
        await page.click('#setSecretAudit')   /* 收起 */
        await H.waitFor(page, '收起落定（列表隐藏 + 钮回「查看」）', async p => p.evaluate(() => {
          var body = document.querySelector('#setSecretAuditBody')
          var btn = document.querySelector('#setSecretAudit')
          return !!(body && body.style.display === 'none' && btn && btn.textContent === '查看')
        }))
        await page.click('#setSecretAudit')   /* 再展开（重新拉取） */
        await H.waitFor(page, '再展开 → 列表渲染两条（倒序 + 标题/会话/机密区数）', async p => p.evaluate(() => {
          var lines = Array.prototype.slice.call(document.querySelectorAll('#setSecretAuditBody .set-audit-line')).map(function (el) { return el.textContent })
          return lines.length === 2
            && lines[0].indexOf('69 审计条目甲') >= 0 && lines[0].indexOf('session-aa11bb22-demo') >= 0 && lines[0].indexOf('2 处机密区') >= 0
            && lines[1].indexOf('69 审计条目乙') >= 0 && lines[1].indexOf('session-bb22cc33-demo') >= 0 && lines[1].indexOf('1 处机密区') >= 0
        }))
        H.t('③ 非空列表渲染：两条条目（倒序最新在前）+ 标题·会话·机密区数随渲染（mock 缓冲真数据源）', true)
        await H.screenshot(page, '69-app-secret-audit-list')
        await page.click('#setSecretAudit')   /* 收尾收拢 */
        await H.waitFor(page, '再点「收起」→ 列表收拢隐藏', async p => p.evaluate(() =>
          document.querySelector('#setSecretAuditBody').style.display === 'none'))
        H.t('③ 收起往返：列表收拢 + 钮文案回「查看」（展开/收起状态机闭环）', await page.evaluate(() =>
          document.querySelector('#setSecretAudit').textContent === '查看'))

        H.t('无 console error / pageerror', page.__consoleErrors.length === 0, () => page.__consoleErrors.slice(0, 3).join(' | '))
        state.secretAudit.length = 0   /* 共享态礼貌收尾（后续用例不受本例造数影响） */
      })
    } finally {
      state.secretAudit.length = 0
      await page.context().close()
    }
  },
}
