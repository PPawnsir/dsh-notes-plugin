'use strict'
/* 文档安全二期（notes-061-docsec-hygiene 池#18 残余面）面板（client）保存时机密检测建议横幅行为级全链
 * （panel-harness 发布版 bundle；app 侧同款先例 = 用例 63）：
 * ① 保存冒泡：种子笔记正文两行凭据（键值行「密码:」+ AKIA 裸凭据）→ 追加打字触发 900ms 防抖自动保存
 *   → notes-update 响应带 secretSuggested {count:2,lines:[2,4]} → 编辑器顶部横幅「检测到 2 处疑似凭据（第 2、4 行）」+ [一键标记][忽略] 双钮；
 * ② 一键标记闭环：点击标记 → 命中行包 ```secret fence（wrapSecretLines 内核同源）→ 横幅自清（React 态摘除）
 *   + 源码面遮蔽块 ×2（S5 语义：标记即遮蔽）+ 富文本机密岛 ×2（S1/S2 打码保护在场）→ 自动保存响应零建议 → 横幅不重现；
 * ③ 忽略 = 本篇本次静默：另一篇带密码笔记 → 编辑触发保存 → 横幅冒泡（第 1 行）→ 点忽略 → 再打字触发同键保存
 *   （noteId:lines 忽略键命中）→ 横幅不再冒泡；
 * ④ 设置区查看入口（池#17 面板端渲染行为级）：面板设置卡「数据与存储」组「机密读取记录」行在案 → 点击「查看」
 *   → 空态「暂无读取记录」→ state.secretAudit 推两条 → 再展开 → 列表渲染两条（标题·会话·机密区数）→ 「收起」。
 * 隔离纪律：seed 承载（mountPanel 独立 context + 独立 mock state，finally close）。 */
const { mountPanel } = require('../panel-harness.cjs')

module.exports = {
  name: '面板保存时检测建议横幅：冒泡 → 一键标记闭环 → 忽略静默 + 设置区机密读取记录行（client）',
  async run({ browser, H }) {
    const h = await mountPanel(browser, {
      seed(state) {
        state.notes.push({
          id: 'e2e-sug-68a', title: '68 面板建议横幅', kind: 'note', topic: '',
          body: '公开开头68\n密码: panel-sug-pw-68\n公开中段68\nAWS_KEY = AKIAIOSFODNN7EXAMPLE\n公开结尾68',
          tags: [], status: 'active', inject: false, injectEver: false, injectRole: 'convention', injectTo: [],
          recall: true, sensitive: false, hidden: false, workspace: 'e2e-workspace', folder: '', sessionId: '',
          cwd: '', logDate: '', entities: [], summarizedAt: '', contractType: '', origin: '', schedule: null,
          mergedFrom: [], dispatches: [], refNote: '', runLog: '', useCount: 0, archivedAt: '',
          createdAt: '2026-10-13T00:00:00.000Z', updatedAt: '2026-10-13T00:00:00.000Z', deleted: false,
        })
        state.notes.push({
          id: 'e2e-sug-68b', title: '68 面板忽略流', kind: 'note', topic: '',
          body: '密码: panel-ignore-pw-68',
          tags: [], status: 'active', inject: false, injectEver: false, injectRole: 'convention', injectTo: [],
          recall: true, sensitive: false, hidden: false, workspace: 'e2e-workspace', folder: '', sessionId: '',
          cwd: '', logDate: '', entities: [], summarizedAt: '', contractType: '', origin: '', schedule: null,
          mergedFrom: [], dispatches: [], refNote: '', runLog: '', useCount: 0, archivedAt: '',
          createdAt: '2026-10-13T00:00:00.000Z', updatedAt: '2026-10-13T00:00:00.000Z', deleted: false,
        })
      },
    })
    try {
      await H.step(h.page, '68-panel-secret-suggest-banner', async () => {
        await h.openPanel()

        /* ===== ① 保存冒泡：选中笔记 A → 追加打字 → 自动保存响应建议 → 横幅（文案含行号） ===== */
        await h.page.click('.dsh-notes-tree .dsh-notes-note-row[data-note="e2e-sug-68a"]')
        await H.waitFor(h.page, '笔记 A 源码模式落定（textarea 含真原文）', async p => p.evaluate(() => {
          var ta = document.querySelector('.dsh-notes-ed-body')
          return !!(ta && ta.value.indexOf('panel-sug-pw-68') >= 0)
        }))
        await h.page.click('.dsh-notes-ed-body')
        await h.page.keyboard.press('Control+End')   /* 光标落文末 */
        await h.page.keyboard.type('\n触发保存68')
        await H.waitFor(h.page, '自动保存响应带 secretSuggested → 横幅冒泡（第 2、4 行两处凭据）', async p => p.evaluate(() => {
          var bn = document.querySelector('.dsh-notes-secret-sug')
          return !!(bn && bn.textContent.indexOf('检测到 2 处疑似凭据') >= 0 && bn.textContent.indexOf('第 2、4 行') >= 0)
        }), 12000)
        H.t('① 保存建议冒泡：update 响应带 secretSuggested → 横幅「检测到 2 处疑似凭据（第 2、4 行）」（文案含行号）', await h.page.evaluate(() => {
          var bn = document.querySelector('.dsh-notes-secret-sug')
          return !!(bn && bn.querySelector('.dsh-notes-sug-act') && bn.querySelector('.dsh-notes-sug-ignore')
            && bn.querySelector('.dsh-notes-sug-act').textContent.indexOf('一键标记') >= 0
            && bn.querySelector('.dsh-notes-sug-ignore').textContent.indexOf('忽略') >= 0)
        }), () => 'banner/buttons missing')
        await H.screenshot(h.page, '68-panel-suggest-banner')

        /* ===== ② 一键标记：命中行包 fence → 横幅自清 + 遮蔽块 ×2 + 富文本机密岛 ×2 → 保存闭环零建议 ===== */
        await h.page.click('.dsh-notes-secret-sug .dsh-notes-sug-act')
        await H.waitFor(h.page, '一键标记落定（两段 ```secret fence + 横幅自清 + 源码遮蔽块 ×2 + 渲染文本层零机密）', async p => p.evaluate(() => {
          var ta = document.querySelector('.dsh-notes-ed-body')
          var layer = document.querySelector('.dsh-notes-src-veil')
          return !!(ta && ta.value.split('\x60\x60\x60secret').length === 3
            && ta.value.indexOf('\x60\x60\x60secret\n密码: panel-sug-pw-68\n\x60\x60\x60') >= 0
            && ta.value.indexOf('\x60\x60\x60secret\nAWS_KEY = AKIAIOSFODNN7EXAMPLE\n\x60\x60\x60') >= 0
            && ta.value.indexOf('公开开头68') >= 0 && ta.value.indexOf('触发保存68') >= 0
            && !document.querySelector('.dsh-notes-secret-sug')
            && layer && layer.querySelectorAll('.src-secret-veil').length === 2
            && layer.textContent.indexOf('panel-sug-pw-68') < 0
            && layer.textContent.indexOf('AKIAIOSFODNN7EXAMPLE') < 0)
        }))
        H.t('② 一键标记：两命中行各包 ```secret fence（内容字节保留）+ 横幅自清 + 源码面遮蔽块 ×2（标记即遮蔽）+ 渲染文本层零机密', true)
        /* 富文本机密岛在场（保护视觉证据） */
        await h.page.click('.dsh-notes-modeseg .dsh-notes-modeseg-seg:has-text("富文本")')
        await H.waitFor(h.page, '富文本机密岛在场（2 块未揭示，data-md-src 逐字源在案）', async p => p.evaluate(() => {
          var pres = document.querySelectorAll('.dsh-notes-rich pre.dsh-notes-secret')
          return pres.length === 2 && !pres[0].classList.contains('revealed')
            && (pres[0].getAttribute('data-md-src') || '').indexOf('panel-sug-pw-68') >= 0
        }))
        H.t('② 机密岛出现：富文本 pre.dsh-notes-secret ×2（未揭示 + data-md-src 在案——S1/S2 打码保护在场）', true)
        await h.page.click('.dsh-notes-modeseg .dsh-notes-modeseg-seg:has-text("源码")')
        await H.waitFor(h.page, '回源码模式', async p => p.evaluate(() => !!document.querySelector('.dsh-notes-ed-body')))
        /* 闭环实证：标记触发自动保存（900ms 防抖 + RPC 回程）→ update 响应零建议（fence 区内行不再建议）→ 横幅不重现 */
        await h.page.waitForTimeout(2600)
        H.t('② 标记闭环：下一次保存响应零建议 → 横幅不重现（fence 区内行不再建议）', await h.page.evaluate(() => !document.querySelector('.dsh-notes-secret-sug')), () => 'banner re-appeared after mark+save')
        const updFenced = h.rpcCalls.find(c => c.method === 'notes-update' && c.args && c.args.id === 'e2e-sug-68a' && typeof c.args.body === 'string' && c.args.body.indexOf('\x60\x60\x60secret') >= 0)
        H.t('② 自动保存 RPC 参数锁：notes-update body 含 ```secret fence（标记经既有自动保存链落落库）', !!updFenced, () => 'rpc body missing')
        await H.screenshot(h.page, '68-panel-suggest-marked')

        /* ===== ③ 忽略 = 本篇本次静默：笔记 B 带密码 → 编辑保存 → 横幅（第 1 行）→ 忽略 → 同键保存不再冒泡 ===== */
        await h.page.click('.dsh-notes-tree .dsh-notes-note-row[data-note="e2e-sug-68b"]')
        await H.waitFor(h.page, '笔记 B 落定（textarea 含密码行）', async p => p.evaluate(() => {
          var ta = document.querySelector('.dsh-notes-ed-body')
          return !!(ta && ta.value.indexOf('panel-ignore-pw-68') >= 0)
        }))
        await h.page.click('.dsh-notes-ed-body')
        await h.page.keyboard.press('Control+End')
        await h.page.keyboard.type('\n忽略流 benign-1')
        await H.waitFor(h.page, '笔记 B 保存 → 横幅冒泡（1 处，第 1 行）', async p => p.evaluate(() => {
          var bn = document.querySelector('.dsh-notes-secret-sug')
          return !!(bn && bn.textContent.indexOf('检测到 1 处疑似凭据') >= 0 && bn.textContent.indexOf('第 1 行') >= 0)
        }), 12000)
        H.t('③ 忽略流冒泡：笔记 B 保存响应建议（第 1 行）横幅在案', true)
        await h.page.click('.dsh-notes-secret-sug .dsh-notes-sug-ignore')
        await H.waitFor(h.page, '忽略即清横幅', async p => p.evaluate(() => !document.querySelector('.dsh-notes-secret-sug')))
        H.t('③ 点「忽略」→ 横幅即清（doSecretIgnore 记账 noteId:lines）', true)
        /* 同键正文保存（再打字 → autosave 带正文 → 响应同行号建议）→ 忽略键静默 */
        await h.page.click('.dsh-notes-ed-body')
        await h.page.keyboard.press('Control+End')
        await h.page.keyboard.type('\n忽略流 benign-2')
        await h.page.waitForTimeout(2400)   /* 900ms 防抖 + RPC 回程：给同键保存一个完整窗口 */
        H.t('③ 忽略静默：本篇本次（同 noteId+同行号集）后续保存不再冒泡（会话级内存态——v1 非持久忽略表）',
          await h.page.evaluate(() => !document.querySelector('.dsh-notes-secret-sug')), () => 'banner re-appeared after ignore')

        /* ===== ④ 设置区查看入口（池#17 面板端）：机密读取记录行 → 查看 → 空态 → 推两条 → 再展开渲染 → 收起 ===== */
        await h.page.click('.dsh-notes-fbtn:has-text("设置")')
        await h.page.waitForSelector('.dsh-notes-settings-rail-item', { timeout: 8000 })
        H.t('④ 设置卡「数据与存储」组：机密读取记录行在案（紧随保存时检测行）', await h.page.evaluate(() => {
          var g = document.querySelector('.dsh-notes-settings-group[data-g="data"]')
          if (!g) return false
          var labels = Array.prototype.slice.call(g.querySelectorAll('.dsh-notes-settings-label')).map(function (el) { return el.textContent })
          var iDetect = labels.findIndex(function (s) { return s.indexOf('保存时检测疑似机密') >= 0 })
          var iAudit = labels.findIndex(function (s) { return s.indexOf('机密读取记录') >= 0 })
          return iDetect >= 0 && iAudit === iDetect + 1
        }))
        const AUDIT_BTN = '.dsh-notes-settings-group[data-g="data"] .dsh-notes-settings-row:has-text("机密读取记录") .dsh-notes-settings-clear'   /* 行内还有 ⓘ 说明钮——动作钮按 class 锚定 */
        await h.page.click(AUDIT_BTN)
        await H.waitFor(h.page, '展开 → 空态「暂无读取记录」（mock 缓冲缺省空）', async p => p.evaluate(() => {
          var list = document.querySelector('.dsh-notes-audit-list')
          return !!(list && list.textContent.indexOf('暂无读取记录') >= 0)
        }))
        H.t('④ 点击「查看」→ 展开只读列表：空态「暂无读取记录」（notes-secret-audit 真接通面板 RPC 链）', true)
        /* 推两条进 mock 缓冲 → 收起再展开（每次展开重新拉取）→ 列表渲染两条（倒序：最新在前） */
        h.state.secretAudit.push(
          { at: '2026-10-13T02:00:00.000Z', note: 'n-e2e-audit-b', title: '68 审计条目乙', session: 'session-bb22cc33-demo', spans: 1 },
          { at: '2026-10-13T03:00:00.000Z', note: 'n-e2e-audit-a', title: '68 审计条目甲', session: 'session-aa11bb22-demo', spans: 2 })
        h.state.secretAudit.reverse()   /* host 口径：倒序（最新在前）——甲(03:00) 应渲染在乙(02:00) 之前 */
        await h.page.click(AUDIT_BTN)   /* 收起 */
        await H.waitFor(h.page, '收起落定（列表摘除）', async p => p.evaluate(() => !document.querySelector('.dsh-notes-audit-list')))
        await h.page.click(AUDIT_BTN)   /* 再展开 */
        await H.waitFor(h.page, '再展开 → 列表渲染两条（倒序 + 标题/会话/机密区数）', async p => p.evaluate(() => {
          var lines = Array.prototype.slice.call(document.querySelectorAll('.dsh-notes-audit-list .dsh-notes-audit-line')).map(function (el) { return el.textContent })
          return lines.length === 2
            && lines[0].indexOf('68 审计条目甲') >= 0 && lines[0].indexOf('session-aa11bb22-demo') >= 0 && lines[0].indexOf('2 处机密区') >= 0
            && lines[1].indexOf('68 审计条目乙') >= 0 && lines[1].indexOf('1 处机密区') >= 0
        }))
        H.t('④ 非空列表渲染：两条条目（倒序最新在前）+ 标题·会话·机密区数随渲染（mock 缓冲真数据源）', true)
        await H.screenshot(h.page, '68-panel-secret-audit-list')

        H.t('无 console error / pageerror', h.consoleErrors.length === 0, () => h.consoleErrors.slice(0, 3).join(' | '))
      })
    } finally { await h.close() }
  },
}
