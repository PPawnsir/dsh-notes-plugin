'use strict'
/* 0.4.7-D2 用例㊱（notes-047-panel-e2e-migrate）：J 卡（check 节 1.5）组分页 eval 探针的真机迁移（D1 用例㉞的姊妹篇）。
 *
 * == 迁移映射（原 eval 断言 → 本用例真机锁；退役裁决见 check/sections/1-5-list-lazy.cjs 头注④⑤块）==
 *   eval「多组独立：A 夹翻页不影响 B 夹/置顶/未入夹/主题组显示数」
 *     → mount A 步②（fA 翻页 60 全量后 fB 仍 50+还有 5 条）+ 步④（fB 翻页后 fA 不回弹）+ mount B 步②（置顶翻页后 fP 夹仍 50）
 *   eval「过滤/搜索/视图切换重置：groupShown 归 {} → 各组回缺省 50」
 *     → mount A 步③（kind 勾选=filters 依赖）/步⑤（搜索输入=searchText 依赖）/步⑥（主题视图切换=view 依赖）——重置 effect 三依赖面全真机
 *   eval「四组同构行为：置顶/未入夹/主题组各自分页 + 加载行（组标识锚 + 元素 key）」
 *     → mount B：置顶/文件夹/未入夹/主题四组各自「50 行 + 加载更多（还有 5 条）」DOM 锁 + 置顶/主题组真机点击翻页全量
 *   eval「sysKids 不占分页名额回归：60 命中 → 50 切片 + 3 sys 置尾 = 53 渲染行，剩余计数按命中全量」
 *     → mount A 步⑦（fS 夹 60 普通 + 3 sys：53 行、sys 置尾序位锁、还有 10 条按命中全量、夹头计数 63 含 sys）
 *   eval「分组分页边界：0 条 / 恰好 50 / 51 条 / 累进翻页 / 越界安全」
 *     → mount B 步⑤（fE0 空夹无加载行 / fE50 恰好 50 无加载行 / fE51 还有 1 条 / fE30 越界安全 30 行）；
 *       「累进翻页 120」由用例㉞既有断言承接（50→100→120 全链）
 *   eval「组内分页行为级：60 条同夹 → 首屏 50 + 还有 10 → 点击 → 60 全渲染 + 行消失」
 *     → 用例㉞（120 条三态链）+ mount A 步①②（恰 60 条同夹同款路径）
 *
 * 强度说明：全部经真 React 渲染树 + 真实点击事件链 + 真 mock RPC（sysKids 补拉走 notes-list {folder} 显式入口），
 *   严格强于原 mkSandbox eval（e 打桩记录元素）；文案断言 = 真 zh 字典插值后的 DOM 文本。
 * 桩数据时间戳严格递增（序号大=新），host 排序 = pinned 优先 + updatedAt 降序，行序确定。 */
const { mountPanel } = require('../panel-harness.cjs')

function mk(id, title, extra, i) {
  const ts = new Date(Date.now() - (9999 - i) * 1000).toISOString()   /* i 大=新 */
  return Object.assign({
    id, title, body: title + ' 正文', topic: '', kind: 'note', tags: [], status: 'active',
    pinned: false, inject: false, injectRole: '', injectTo: [], recall: true, folder: '',
    useCount: 0, contractType: '', createdAt: ts, updatedAt: ts, deleted: false,
  }, extra || {})
}

module.exports = {
  name: '㊱ 面板分组分页：多组独立 + 过滤/搜索/视图三重置 + 四组同构 + sysKids 置尾不占名额 + 边界（0/50/51/30）',
  async run({ browser, H }) {
    /* 组容器定位与量测：kind ∈ folder/pinned/unfiled/topic；返回 {found, rows, more, tail} */
    const groupBox = (h, kind, name) => h.page.evaluate(({ kind, name }) => {
      function boxOf(headEl) { const nx = headEl && headEl.nextElementSibling; return nx && nx.classList.contains('dsh-notes-nested') ? nx : null }
      let box = null
      if (kind === 'unfiled') box = document.querySelector('.dsh-notes-tree .dsh-notes-unfiled-drop')
      else if (kind === 'pinned') {
        const hd = Array.from(document.querySelectorAll('.dsh-notes-tree .dsh-notes-sec-toggle')).find(x => x.textContent.indexOf('置顶') >= 0)
        box = hd ? boxOf(hd) : null
      } else if (kind === 'folder') {
        const row = Array.from(document.querySelectorAll('.dsh-notes-tree .dsh-notes-folder-row'))
          .find(r => { const nm = r.querySelector('.dsh-notes-row-nm'); return nm && nm.textContent === name })
        box = row ? boxOf(row) : null
      } else if (kind === 'topic') {
        const row = Array.from(document.querySelectorAll('.dsh-notes-tree .dsh-notes-topic-row'))
          .find(r => { const nm = r.querySelector('.dsh-notes-row-nm'); return nm && nm.textContent === name })
        box = row ? boxOf(row) : null
      }
      if (!box) return { found: false, rows: -1, more: null, titles: [] }
      const more = box.querySelector('.dsh-notes-more-row')
      const titles = Array.from(box.querySelectorAll('.dsh-notes-note-row .dsh-notes-note-ti')).map(el => el.textContent)
      return { found: true, rows: titles.length, more: more ? more.textContent.trim() : null, titles: titles }
    }, { kind, name })
    /* 真机点击组尾加载行（Playwright 真实鼠标事件链 → React onClick） */
    const clickMore = async (h, kind, name) => {
      let loc
      if (kind === 'unfiled') loc = h.page.locator('.dsh-notes-tree .dsh-notes-unfiled-drop .dsh-notes-more-row')
      else if (kind === 'pinned') loc = h.page.locator('.dsh-notes-tree .dsh-notes-sec-toggle', { hasText: '置顶' })
        .locator('xpath=following-sibling::div[contains(@class,"dsh-notes-nested")][1]').locator('.dsh-notes-more-row')
      else if (kind === 'folder') loc = h.page.locator('.dsh-notes-tree .dsh-notes-folder-row', { hasText: name })
        .locator('xpath=following-sibling::div[contains(@class,"dsh-notes-nested")][1]').locator('.dsh-notes-more-row')
      else loc = h.page.locator('.dsh-notes-tree .dsh-notes-topic-row', { hasText: name })
        .locator('xpath=following-sibling::div[contains(@class,"dsh-notes-nested")][1]').locator('.dsh-notes-more-row')
      await loc.click()
    }
    const waitBox = (h, desc, kind, name, pred) => H.waitFor(h.page, desc, async () => {
      const b = await groupBox(h, kind, name)
      return b.found && pred(b)
    })

    /* ===== mount A：多组独立 + 三重置 + sysKids 置尾 ===== */
    const hA = await mountPanel(browser, {
      seed(state) {
        state.notes.length = 0
        state.folders.length = 0
        state.folders.push({ id: 'fA', name: 'A夹', parent: '', order: 1, count: 0 })
        state.folders.push({ id: 'fB', name: 'B夹', parent: '', order: 2, count: 0 })
        state.folders.push({ id: 'fS', name: 'S夹', parent: '', order: 3, count: 0 })
        let i = 0
        for (let k = 1; k <= 60; k++) state.notes.push(mk('pa-' + k, 'A夹笔记 ' + String(k).padStart(3, '0'), { folder: 'fA' }, ++i))
        /* fB 带主题「归置」：供视图切换重置腿（主题区有内容可点过滤图标） */
        for (let k = 1; k <= 55; k++) state.notes.push(mk('pb-' + k, 'B夹笔记 ' + String(k).padStart(3, '0'), { folder: 'fB', topic: '归置' }, ++i))
        for (let k = 1; k <= 60; k++) state.notes.push(mk('ps-' + k, 'S夹笔记 ' + String(k).padStart(3, '0'), { folder: 'fS' }, ++i))
        for (let k = 1; k <= 3; k++) state.notes.push(mk('ps-sys' + k, 'S夹机器行 ' + k, { folder: 'fS', kind: 'sys' }, ++i))
        for (let k = 1; k <= 3; k++) state.notes.push(mk('pu-' + k, '散落笔记 ' + k, {}, ++i))
      },
    })
    try {
      await H.step(hA.page, '36-panel-group-paging-a', async () => {
        await hA.openPanel()
        /* 步① 首屏：fA 50+「还有 10 条」、fB 50+「还有 5 条」（文件夹缺省全展开；映射 eval「60 条同夹首屏」） */
        await waitBox(hA, 'fA 首屏 50 行 + 还有 10 条', 'folder', 'A夹', b => b.rows === 50 && b.more === '加载更多（还有 10 条）')
        H.t('A① fA 首屏 50 行 + 组尾「加载更多（还有 10 条）」（真机等价 eval 组内分页首屏半段）', true)
        await waitBox(hA, 'fB 首屏 50 行 + 还有 5 条', 'folder', 'B夹', b => b.rows === 50 && b.more === '加载更多（还有 5 条）')
        H.t('A① fB 首屏 50 行 + 组尾「还有 5 条」（各组独立缺省 PAGE_SIZE）', true)

        /* 步② 多组独立①：fA 翻页 → 60 全量 + 行消失；fB 不动（映射 eval「多组独立」正向） */
        await clickMore(hA, 'folder', 'A夹')
        await waitBox(hA, 'fA 翻页后 60 全量、加载行消失', 'folder', 'A夹', b => b.rows === 60 && b.more === null)
        H.t('A② fA 点击翻页 → 60 条全渲染 + 组尾加载行消失（真机等价 eval 点击全渲染半段）', true)
        const bAfterA = await groupBox(hA, 'folder', 'B夹')
        H.t('A② 多组独立：fA 翻页后 fB 仍 50 行 + 「还有 5 条」不动', bAfterA.rows === 50 && bAfterA.more === '加载更多（还有 5 条）', () => JSON.stringify(bAfterA))

        /* 步③ 重置腿一（filters 依赖）：勾「笔记」→ groupShown 归零 → fA 回 50+加载行 */
        await hA.page.click('.dsh-notes-fbtn-filter')
        await hA.page.waitForSelector('.dsh-notes-fpop', { timeout: 8000 })
        const clickKind = async (label) => {
          const item = hA.page.locator('.dsh-notes-fpop label.dsh-notes-fg-item', { has: hA.page.locator('.dsh-notes-fg-fl', { hasText: label }) }).first()
          await item.locator('input[type=checkbox]').click()
        }
        await clickKind('笔记')
        await waitBox(hA, '勾「笔记」后 fA 回 50 行 + 还有 10 条', 'folder', 'A夹', b => b.rows === 50 && b.more === '加载更多（还有 10 条）')
        H.t('A③ 重置·筛选中心：kind 勾选 → fA 翻页态归零回缺省 50（重置 effect filters 依赖真机锁）', true)
        await clickKind('笔记')   /* 摘回：再次归零，口径稳定 */
        await waitBox(hA, '摘「笔记」后 fA 仍 50 行 + 还有 10 条', 'folder', 'A夹', b => b.rows === 50 && b.more === '加载更多（还有 10 条）')
        H.t('A③ 摘回 kind 后口径稳定（再次归零不复弹）', true)
        await hA.page.click('.dsh-notes-fbtn-filter')   /* 收浮层 */

        /* 步④ 多组独立②（反向）：fB 翻页 → 55 全量；fA 不动 */
        await clickMore(hA, 'folder', 'B夹')
        await waitBox(hA, 'fB 翻页后 55 全量、加载行消失', 'folder', 'B夹', b => b.rows === 55 && b.more === null)
        const aAfterB = await groupBox(hA, 'folder', 'A夹')
        H.t('A④ 多组独立（反向）：fB 翻页后 fA 仍 50 行 + 加载行不动', aAfterB.rows === 50 && aAfterB.more === '加载更多（还有 10 条）', () => JSON.stringify(aAfterB))

        /* 步⑤ 重置腿二（searchText 依赖）：搜索输入 → fB 回 50+加载行；清空后口径稳定 */
        await hA.page.fill('.dsh-notes-quick-input', 'B夹')
        await waitBox(hA, '搜索「B夹」后 fB 回 50 行 + 还有 5 条', 'folder', 'B夹', b => b.rows === 50 && b.more === '加载更多（还有 5 条）')
        H.t('A⑤ 重置·搜索：输入搜索词 → fB 翻页态归零回缺省 50（重置 effect searchText 依赖真机锁）', true)
        await hA.page.fill('.dsh-notes-quick-input', '')
        await waitBox(hA, '清空搜索后 fB 仍 50 行 + 还有 5 条', 'folder', 'B夹', b => b.rows === 50 && b.more === '加载更多（还有 5 条）')
        H.t('A⑤ 清空搜索后口径稳定', true)

        /* 步⑥ 重置腿三（view 依赖）：fA 先翻页 → 主题视图切换 → 回全视图 → fA 回 50+加载行 */
        await clickMore(hA, 'folder', 'A夹')
        await waitBox(hA, 'fA 再翻页 60 全量', 'folder', 'A夹', b => b.rows === 60 && b.more === null)
        await hA.page.locator('.dsh-notes-tree .dsh-notes-sec-toggle', { hasText: '标签' }).first().click()   /* 展开标签区（0.4.8 主题并入标签） */
        const topicRow = hA.page.locator('.dsh-notes-tree .dsh-notes-topic-row', { hasText: '归置' }).first()
        await topicRow.waitFor({ timeout: 8000 })
        await topicRow.locator('.dsh-notes-row-vfilter').click()   /* 行尾过滤图标 → 主题视图 */
        await H.waitFor(hA.page, '主题视图生效（视图头 × 清除钮出现）', async p =>
          p.evaluate(() => !!document.querySelector('.dsh-notes-tree .dsh-notes-sec-h-clear')))
        await waitBox(hA, '主题视图下 fB 回 50 行 + 还有 5 条（view 切换重置即时可见）', 'folder', 'B夹', b => b.rows === 50 && b.more === '加载更多（还有 5 条）')
        H.t('A⑥ 重置·视图切换：切主题视图 → 各组翻页态归零（重置 effect view 依赖真机锁）', true)
        await hA.page.click('.dsh-notes-tree .dsh-notes-sec-h-clear')   /* × 回全视图（再触发一次 view 重置） */
        await waitBox(hA, '回全视图后 fA 回 50 行 + 还有 10 条', 'folder', 'A夹', b => b.rows === 50 && b.more === '加载更多（还有 10 条）')
        H.t('A⑥ 回全视图后 fA 翻页态不残留（60 全量态已归零）', true)

        /* 步⑦ sysKids 不占分页名额（映射 eval sysKids 回归）：60 命中 → 50 切片 + 3 sys 置尾 = 53 行，剩余计数按命中全量 */
        await waitBox(hA, 'fS 渲染 53 行（50 切片 + 3 sys 置尾）+ 还有 10 条', 'folder', 'S夹', b =>
          b.rows === 53 && b.more === '加载更多（还有 10 条）' &&
          b.titles[50] === 'S夹机器行 3' && b.titles[51] === 'S夹机器行 2' && b.titles[52] === 'S夹机器行 1')
        H.t('A⑦ sysKids 置尾合并在分页 slice 之后：53 行 = 50 切片 + 3 sys 置尾（序位锁：第 51~53 行为机器行）', true)
        const fsCnt = await hA.page.evaluate(() => {
          const row = Array.from(document.querySelectorAll('.dsh-notes-tree .dsh-notes-folder-row'))
            .find(r => { const nm = r.querySelector('.dsh-notes-row-nm'); return nm && nm.textContent === 'S夹' })
          const cn = row && row.querySelector('.dsh-notes-row-n')
          return cn ? cn.textContent.trim() : '(missing)'
        })
        H.t('A⑦ fS 夹头计数 63（host count 含 sys 全量口径）+ 加载行剩余数按命中全量 60 口径（还有 10 条，sys 不占名额）', fsCnt === '63', () => '夹头计数实得 ' + fsCnt)

        H.t('A 全程无 console error / pageerror', hA.consoleErrors.length === 0, () => hA.consoleErrors.slice(0, 3).join(' | '))
        await H.screenshot(hA.page, '36-panel-group-paging-a')
      })
    } finally { await hA.close() }

    /* ===== mount B：四组同构 + 边界（0/恰好 50/51/越界 30）===== */
    const hB = await mountPanel(browser, {
      seed(state) {
        state.notes.length = 0
        state.folders.length = 0
        state.folders.push({ id: 'fP', name: '钉夹', parent: '', order: 1, count: 0 })
        state.folders.push({ id: 'fT', name: '运维夹', parent: '', order: 2, count: 0 })
        state.folders.push({ id: 'fE50', name: '整五十夹', parent: '', order: 3, count: 0 })
        state.folders.push({ id: 'fE51', name: '五一夹', parent: '', order: 4, count: 0 })
        state.folders.push({ id: 'fE30', name: '三十夹', parent: '', order: 5, count: 0 })
        state.folders.push({ id: 'fE0', name: '空夹', parent: '', order: 6, count: 0 })
        let i = 0
        for (let k = 1; k <= 55; k++) state.notes.push(mk('bp-' + k, '置顶笔记 ' + String(k).padStart(3, '0'), { folder: 'fP', status: 'pinned' }, ++i))
        for (let k = 1; k <= 55; k++) state.notes.push(mk('bt-' + k, '运维笔记 ' + String(k).padStart(3, '0'), { folder: 'fT', topic: '运维' }, ++i))
        for (let k = 1; k <= 55; k++) state.notes.push(mk('bu-' + k, '散落笔记 ' + String(k).padStart(3, '0'), {}, ++i))
        for (let k = 1; k <= 50; k++) state.notes.push(mk('b50-' + k, '整五十 ' + String(k).padStart(3, '0'), { folder: 'fE50' }, ++i))
        for (let k = 1; k <= 51; k++) state.notes.push(mk('b51-' + k, '五一笔记 ' + String(k).padStart(3, '0'), { folder: 'fE51' }, ++i))
        for (let k = 1; k <= 30; k++) state.notes.push(mk('b30-' + k, '三十笔记 ' + String(k).padStart(3, '0'), { folder: 'fE30' }, ++i))
      },
    })
    try {
      await H.step(hB.page, '36-panel-group-paging-b', async () => {
        await hB.openPanel()
        /* 步① 四组同构首屏：置顶（缺省展开）/文件夹/未入夹 各 50+「还有 5 条」；主题组展开后同构 */
        await waitBox(hB, '置顶组首屏 50 行 + 还有 5 条', 'pinned', '', b => b.rows === 50 && b.more === '加载更多（还有 5 条）')
        H.t('B① 四组同构·置顶组：首屏 50 行 + 组尾「加载更多（还有 5 条）」（组标识 pinned）', true)
        await waitBox(hB, '钉夹首屏 50 行 + 还有 5 条', 'folder', '钉夹', b => b.rows === 50 && b.more === '加载更多（还有 5 条）')
        H.t('B① 四组同构·文件夹组：钉夹首屏 50 行 + 加载行（组标识 folder.id；与置顶组同一份笔记各自分页）', true)
        await waitBox(hB, '未入夹区首屏 50 行 + 还有 5 条', 'unfiled', '', b => b.rows === 50 && b.more === '加载更多（还有 5 条）')
        H.t('B① 四组同构·未入夹区：首屏 50 行 + 加载行（组标识 unfiled）', true)
        /* 主题组：标签区缺省折叠 → 展开 → 点主题行展开 → 50+加载行（0.4.8 主题并入标签，组头文案「标签」） */
        await hB.page.locator('.dsh-notes-tree .dsh-notes-sec-toggle', { hasText: '标签' }).first().click()
        await hB.page.locator('.dsh-notes-tree .dsh-notes-topic-row', { hasText: '运维' }).first().click()
        await waitBox(hB, '主题组首屏 50 行 + 还有 5 条', 'topic', '运维', b => b.rows === 50 && b.more === '加载更多（还有 5 条）')
        H.t('B① 四组同构·主题组：展开后首屏 50 行 + 加载行（组标识 topic:运维）', true)

        /* 步② 置顶组真机翻页 + 跨组独立（pinned vs 文件夹） */
        await clickMore(hB, 'pinned', '')
        await waitBox(hB, '置顶组翻页后 55 全量、加载行消失', 'pinned', '', b => b.rows === 55 && b.more === null)
        const fpAfter = await groupBox(hB, 'folder', '钉夹')
        H.t('B② 置顶组点击翻页 → 55 全量 + 行消失；钉夹（同一批笔记）仍 50+加载行（跨组独立再锁）',
          fpAfter.rows === 50 && fpAfter.more === '加载更多（还有 5 条）', () => JSON.stringify(fpAfter))

        /* 步③ 主题组真机翻页（四组同构翻页链补齐：未入夹翻页由用例㉞承接、文件夹翻页由 mount A 承接） */
        await clickMore(hB, 'topic', '运维')
        await waitBox(hB, '主题组翻页后 55 全量、加载行消失', 'topic', '运维', b => b.rows === 55 && b.more === null)
        H.t('B③ 主题组点击翻页 → 55 全量 + 行消失（topic: 组标识翻页真机锁）', true)

        /* 步④ 未入夹区翻页后回读 55（未入夹 50→55 一步到顶，行消失） */
        await clickMore(hB, 'unfiled', '')
        await waitBox(hB, '未入夹区翻页后 55 全量、加载行消失', 'unfiled', '', b => b.rows === 55 && b.more === null)
        H.t('B④ 未入夹区点击翻页 → 55 全量 + 行消失', true)

        /* 步⑤ 边界四连（映射 eval「0 条 / 恰好 50 / 51 条 / 越界安全」） */
        await waitBox(hB, '整五十夹恰好 50 行、无加载行', 'folder', '整五十夹', b => b.rows === 50 && b.more === null)
        H.t('B⑤ 边界·恰好 50：全渲染且无加载行（无剩余）', true)
        await waitBox(hB, '五一夹 50 行 + 还有 1 条', 'folder', '五一夹', b => b.rows === 50 && b.more === '加载更多（还有 1 条）')
        H.t('B⑤ 边界·51 条：首屏 50 + 「还有 1 条」', true)
        await waitBox(hB, '三十夹 30 行、无加载行（显示数越界安全）', 'folder', '三十夹', b => b.rows === 30 && b.more === null)
        H.t('B⑤ 边界·越界安全：30 条 < 缺省显示数 → 30 行无加载行', true)
        const emptyBox = await groupBox(hB, 'folder', '空夹')
        H.t('B⑤ 边界·0 条：空夹无 nested 容器、无加载行', emptyBox.found === false, () => JSON.stringify(emptyBox))

        H.t('B 全程无 console error / pageerror', hB.consoleErrors.length === 0, () => hB.consoleErrors.slice(0, 3).join(' | '))
        await H.screenshot(hB.page, '36-panel-group-paging-b')
      })
    } finally { await hB.close() }
  },
}
