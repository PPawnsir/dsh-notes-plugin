'use strict';
/* 文档安全 S4 用例（notes-052-autodetect-i18n）app 端保存时机密检测建议全链：
 * ① 保存冒泡：新草稿正文两行凭据（键值行「密码:」+ AKIA 裸凭据）→ 900ms 防抖落库（notes-create 响应
 *   带 secretSuggested）→ 编辑器顶部横幅「检测到 2 处疑似凭据（第 2、4 行）」+ [一键标记][忽略] 双钮；
 * ② 一键标记闭环：点击标记 → 命中行包 ```secret fence（wrapSecretLines：相邻合并/从后往前）→ 自动保存
 *   （notes-update 响应零建议——fence 区内行不再建议）→ 横幅自清；富文本 = 机密岛模糊（S1/S2 打码保护在场）；
 * ③ 忽略 = 本篇本次静默：新草稿带密码 → 横幅出现 → 点忽略 → 再打字触发正文保存（建议同行号）→ 横幅不再冒泡；
 * ④ 开关只管建议不管保护（裁决锁断言）：设置「数据与存储」组取消勾选「保存时检测疑似机密」→ 新草稿带密码
 *   落库 → 横幅不出现（开关关 = mock/host 恒零建议字段）；而已标记笔记的机密岛照常模糊（保护管线不受开关影响）；
 * ⑤ 持久化：settings.secretDetect.enabled===false 经 settings-set 落 mock 状态（真实 UI 链路）。
 * 隔离纪律：新草稿承载（finally 关 context）；收尾 delete state.settings.secretDetect 还原缺省开。 */
module.exports = {
  name: '文档安全 S4：保存时检测建议横幅 → 一键标记闭环 → 忽略静默 → 开关只管建议不管保护（app）',
  async run({ base, browser, H, state }) {
    const page = await H.newPage(browser, base)
    try {
      await H.step(page, '63-secret-autodetect', async () => {
        /* ===== ① 保存冒泡：草稿正文两行凭据 → create 响应建议 → 横幅 ===== */
        await page.click('#btnNew')
        await page.waitForSelector('#edTitle', { timeout: 8000 })
        await page.click('#edTitle')
        await page.keyboard.type('63 建议流')
        await page.click('#edSrc')
        await page.keyboard.type('公开开头\n密码: e2e-suggest-pw-77\n公开中段\nAWS_KEY = AKIAIOSFODNN7EXAMPLE\n公开结尾')
        await H.waitFor(page, '落库 + 建议横幅冒泡（第 2、4 行两处凭据）', async p => p.evaluate(() => {
          var bn = document.querySelector('#secretSug')
          var msg = document.querySelector('#secretSugMsg')
          return !!(bn && bn.style.display !== 'none' && msg && msg.textContent.indexOf('2 处疑似凭据') >= 0
            && msg.textContent.indexOf('第 2、4 行') >= 0)
        }), 12000)
        H.t('① 保存建议冒泡：草稿落库响应带 secretSuggested → 横幅「检测到 2 处疑似凭据（第 2、4 行）」+ 一键标记/忽略双钮', await page.evaluate(() => {
          var bn = document.querySelector('#secretSug')
          return !!(bn && document.querySelector('#secretSugMark') && document.querySelector('#secretSugIgnore')
            && (document.querySelector('#secretSugMsg').textContent || '').indexOf('检测到') >= 0)
        }), 'banner/buttons missing')
        await H.screenshot(page, '63-secret-autodetect-banner')

        /* ===== ② 一键标记：命中行包 fence → 保存响应零建议 → 横幅自清 + 机密岛模糊 ===== */
        await page.click('#secretSugMark')
        await H.waitFor(page, '一键标记落定（源码含两段 ```secret fence + 染色镜像色带）', async p => p.evaluate(() => {
          var ta = document.querySelector('#edSrc')
          var mi = document.querySelector('#srcMirror')
          return !!(ta && ta.value.split('\x60\x60\x60secret').length === 3
            && ta.value.indexOf('\x60\x60\x60secret\n密码: e2e-suggest-pw-77\n\x60\x60\x60') >= 0
            && mi && mi.querySelectorAll('.src-secret').length >= 4)
        }))
        H.t('② 一键标记：两独立命中区间各包一段 ```secret fence（wrapSecretLines 相邻合并/从后往前）+ 内容字节保留', true)
        /* 闭环实证：标记触发自动保存（900ms 防抖 + RPC 回程）→ update 响应零建议（fence 区内行不再建议）→ 横幅不再冒泡 */
        await page.waitForTimeout(2600)
        const closed = await page.evaluate(() => {
          var bn = document.querySelector('#secretSug')
          return !bn || bn.style.display === 'none'
        })
        H.t('② 标记闭环：下一次保存响应零建议 → 横幅不重现（已标记 span 内行不再建议）', closed, () => 'banner re-appeared after mark+save')
        /* 富文本 = 机密岛模糊（保护在场：标记即保护，与建议开关无关的视觉证据） */
        await page.click('#segRich')
        await H.waitFor(page, '富文本机密岛在场（2 块模糊，S1/S2 打码保护）', async p => p.evaluate(() =>
          document.querySelectorAll('#edRich pre.dsh-notes-secret').length === 2))
        const protectA = await page.evaluate(() => {
          var pre = document.querySelector('#edRich pre.dsh-notes-secret')
          return !!(pre && !pre.classList.contains('revealed') && (pre.getAttribute('data-md-src') || '').indexOf('e2e-suggest-pw-77') >= 0)
        })
        H.t('② 保护在场：机密岛未揭示 + data-md-src 逐字源在案（blur 纯 CSS）', protectA, () => 'island state wrong')
        await page.evaluate(() => { var seg = document.querySelector('.seg[data-m="source"]'); if (seg) seg.click() })
        await H.waitFor(page, '回源码模式', async p => p.evaluate(() => {
          var w = document.querySelector('#srcWrap')
          return !!(w && w.style.display !== 'none')
        }))

        /* ===== ③ 忽略 = 本篇本次静默：新草稿带密码 → 横幅 → 忽略 → 同键保存不再冒泡 ===== */
        await page.click('#btnNew')
        await page.waitForSelector('#edTitle', { timeout: 8000 })
        await page.click('#edTitle')
        await page.keyboard.type('63 忽略流')
        await page.click('#edSrc')
        await page.keyboard.type('密码: e2e-ignore-pw-33')
        await H.waitFor(page, '第二草稿落库 + 建议横幅冒泡（1 处）', async p => p.evaluate(() => {
          var bn = document.querySelector('#secretSug')
          return !!(bn && bn.style.display !== 'none')
        }), 12000)
        await page.click('#secretSugIgnore')
        await H.waitFor(page, '忽略即清横幅', async p => p.evaluate(() => {
          var bn = document.querySelector('#secretSug')
          return !!(bn && bn.style.display === 'none')
        }))
        /* 同键正文保存（再打字 → autosave 带正文 → 响应同行号建议）→ 忽略键静默 */
        await page.keyboard.type('\n忽略后再打一行')
        await page.waitForTimeout(2200)   /* 900ms 防抖 + RPC 回程：给同键保存一个完整窗口 */
        const stayedHidden = await page.evaluate(() => {
          var bn = document.querySelector('#secretSug')
          return !bn || bn.style.display === 'none'
        })
        H.t('③ 忽略静默：本篇本次（同 noteId+同行号集）后续保存不再冒泡（v1 非持久忽略表——会话级内存态）', stayedHidden, () => 'banner re-appeared after ignore')

        /* ===== ④ 开关只管建议不管保护（裁决锁）：设置取消勾选 → 含密码草稿零横幅 + 已标记机密岛照常模糊 ===== */
        await page.click('#btnSettings')
        await page.waitForSelector('#setBody .set-row', { timeout: 8000 })
        const sdRow = await page.evaluate(() => {
          const sec = document.querySelector('#setBody .set-row[data-sec="secretdetect"]')
          return {
            inDataGroup: !!(sec && sec.closest('.set-group') && sec.closest('.set-group').getAttribute('data-g') === 'data'),
            chk: !!document.querySelector('#setSecretDetect'),
            checked: !!(document.querySelector('#setSecretDetect') || {}).checked,
          }
        })
        H.t('④ 设置卡「数据与存储」组渲染：secretdetect 行在案 + 勾选框缺省 ✓ 开', sdRow.inDataGroup && sdRow.chk && sdRow.checked, () => JSON.stringify(sdRow))
        await page.click('#setSecretDetect')
        await page.waitForTimeout(600)   /* 选择即存（settings-set 回程） */
        const offPersisted = await page.evaluate(() => !document.querySelector('#setSecretDetect').checked)
        H.t('④ 取消勾选落定（UI 态翻转）', offPersisted)
        await page.evaluate(() => { var x = document.querySelector('#setClose'); if (x) x.click() })
        await page.waitForTimeout(400)
        /* 开关关 → 含密码新草稿落库零横幅（仅管建议） */
        await page.click('#btnNew')
        await page.waitForSelector('#edTitle', { timeout: 8000 })
        await page.click('#edTitle')
        await page.keyboard.type('63 开关关流')
        await page.click('#edSrc')
        await page.keyboard.type('密码: e2e-off-pw-55')
        await page.waitForTimeout(3200)   /* 900ms 防抖落库 + RPC 回程：开关关场景横幅必须始终缺席 */
        const offNoBanner = await page.evaluate(() => {
          var bn = document.querySelector('#secretSug')
          return !bn || bn.style.display === 'none'
        })
        H.t('④ 开关关：含密码笔记保存零建议冒泡（仅管建议——响应零建议字段）', offNoBanner, () => 'banner appeared while secretDetect off')
        /* 已标记的机密仍打码：开回 ② 号笔记 → 富文本机密岛照常模糊（保护管线不设任何开关） */
        const idA = state.notes.find(n => n.title === '63 建议流' && !n.deleted).id
        const clicked = await page.evaluate(function (id) {
          var row = document.querySelector('#tree .note-row[data-note="' + id + '"]')
          if (row) row.click()
          return !!row
        }, idA)
        if (!clicked) throw new Error('④ 笔记行未找到（data-note=id 锚定失败）')
        await page.waitForSelector('#edSrc', { timeout: 8000 })
        await page.click('#segRich')
        await H.waitFor(page, '开关关后已标记笔记机密岛照常模糊（保护不受开关影响）', async p => p.evaluate(() =>
          document.querySelectorAll('#edRich pre.dsh-notes-secret').length === 2), 12000)
        const protectStill = await page.evaluate(() => {
          var pre = document.querySelector('#edRich pre.dsh-notes-secret')
          return !!(pre && !pre.classList.contains('revealed'))
        })
        H.t('④ 保护在场（锁断言）：开关关 → 建议零冒泡，但已标记机密照常模糊打码（开关只管建议不管保护）', protectStill)
        await H.screenshot(page, '63-secret-autodetect-off-still-masked')

        /* ===== ⑤ 持久化：settings-set 真实 UI 链路落 mock 状态 ===== */
        const sdState = state.settings.secretDetect
        H.t('⑤ 开关持久化：settings.secretDetect={enabled:false} 经设置卡 UI 链路落盘（settings-set 白名单）',
          sdState && sdState.enabled === false, () => JSON.stringify(sdState))
        delete state.settings.secretDetect   /* 还原缺省开（e2e 共享态礼貌收尾——后续用例不受本例开关影响） */
      })
    } finally {
      await page.context().close()
    }
  },
}
