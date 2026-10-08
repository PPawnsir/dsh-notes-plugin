'use strict'
/* 0.4.8 用例㊷（notes-048-topic-tag-merge）：主题废弃并入标签（B 方案懒合并）的面板真机锁。
 *
 * == 锁点（check 节 109 的结构/eval 断言 → 本用例真机承接）==
 *   ① 侧栏「主题 (N)」区 →「标签 (N)」区：分组头文案；多值分组（双标签笔记同时进两组）；
 *      组头计数 = 去重篇数（topic-only 旧版笔记经 effTags 读侧虚拟合并并入对应标签组）；
 *      原「未分类」主题桶消失（无 data-topic="未分类" 组行；未入夹区不受影响）；
 *      「分类中」瞬态占位组保留并显示映射为「识别中」。
 *   ② 标签视图过滤：行尾 vfilter → 视图头「标签 · 运维048」+ 列表只剩 effTag 命中笔记（topic-only 也命中）。
 *   ③ 编辑器 meta：主题 chip 下线（无 .dsh-notes-meta-topic-input）；标签编辑控件在位（chips + 添加输入）；
 *      选中折叠真机锁：topic-only 笔记打开后 chips 含折叠值「运维048」；面包屑标签段 = 首枚有效标签。
 *   ④ 写侧惰性落盘真机锁：改标题触发自动保存 → notes-update payload：tags 含「运维048」+ topic === ''
 *      （mock state 落盘同步清空——懒迁移发生且只发生在保存路径）。
 *   ⑤ 标签编辑控件交互：「新标签048,」逗号提交成 chip 并随自动保存落盘；✕ 移除折叠 chip「运维048」后
 *      保存 payload：tags 不含运维048 且 topic 仍 ''（移除生效、不回魂）。
 * 桩数据：state.notes 直给 slim 字段（topic/tags 混布矩阵：topic-only / 双标签 / 未分类+标签 / 裸 / 分类中占位）。 */
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
  name: '㊷ 0.4.8 主题并入标签：标签树多值分组 + 未分类桶消失 + 标签视图过滤 + 写侧合并 payload + 标签编辑控件',
  async run({ browser, H }) {
    const h = await mountPanel(browser, {
      seed(state) {
        state.notes.length = 0
        state.folders.length = 0
        state.notes.push(mk('tt-1', '纯主题旧版笔记', { topic: '运维048' }, 1))                    /* topic-only：effTags 并入「运维048」组 */
        state.notes.push(mk('tt-2', '双标签笔记', { tags: ['发布048', '运维048'] }, 2))            /* 多值：同进「发布048」「运维048」两组 */
        state.notes.push(mk('tt-3', '未分类带标签笔记', { topic: '未分类', tags: ['发布048'] }, 3)) /* 未分类 topic 不进组；tags 照常进 */
        state.notes.push(mk('tt-4', '裸笔记无标签', {}, 4))                                       /* 不进任何标签组 */
        state.notes.push(mk('tt-5', '分类中占位笔记', { topic: '分类中' }, 5))                    /* 「识别中」组（占位映射） */
      },
    })
    try {
      await H.step(h.page, '42-topic-tag-merge', async () => {
        await h.openPanel()

        /* ===== ① 标签树：分组头 + 组清单 + 计数 + 未分类桶消失 + 占位映射 ===== */
        await H.waitFor(h.page, '标签区组头出现', async p =>
          p.evaluate(() => Array.from(document.querySelectorAll('.dsh-notes-tree .dsh-notes-sec-toggle')).some(x => x.textContent.indexOf('标签') >= 0)))
        const headInfo = await h.page.evaluate(() => {
          const hd = Array.from(document.querySelectorAll('.dsh-notes-tree .dsh-notes-sec-toggle')).find(x => x.textContent.indexOf('标签') >= 0)
          return hd ? hd.textContent.trim() : ''
        })
        H.t('① 侧栏分组头 = 「标签 (3)」（主题区下线；组数 = effTags 键数：分类中/发布048/运维048）', /标签\s*\(3\)/.test(headInfo), () => '实得 ' + headInfo)
        await h.page.locator('.dsh-notes-tree .dsh-notes-sec-toggle', { hasText: '标签' }).first().click()
        await h.page.waitForSelector('.dsh-notes-tree .dsh-notes-topic-row', { timeout: 8000 })
        /* client React 行无 data-* 属性（键在 React key 上）——按行名 .dsh-notes-row-nm 文本定位（「分类中」显示映射「识别中」） */
        const groupRows = await h.page.evaluate(() =>
          Array.from(document.querySelectorAll('.dsh-notes-tree .dsh-notes-topic-row')).map(r => {
            const nm = r.querySelector('.dsh-notes-row-nm'), cn = r.querySelector('.dsh-notes-row-n')
            return { name: nm ? nm.textContent.trim() : '?', count: cn ? cn.textContent.trim() : '?' }
          }))
        const names = groupRows.map(r => r.name)
        H.t('① 标签组三枚（sort 码位序：识别中(分类中) < 发布048 < 运维048；topic-only 笔记的 topic 成为组键）',
          JSON.stringify(names) === JSON.stringify(['识别中', '发布048', '运维048']), () => JSON.stringify(groupRows))
        H.t('① 「分类中」占位组显示映射为「识别中」', names.indexOf('识别中') >= 0 && names.indexOf('分类中') < 0, () => JSON.stringify(groupRows))
        H.t('① 原「未分类」主题桶消失（无未分类标签组行；未入夹区不受影响）', names.indexOf('未分类') < 0, () => JSON.stringify(names))
        const counts = {}
        groupRows.forEach(r => { counts[r.name] = r.count })
        H.t('① 组头计数 = 去重篇数（发布048=2：tt-2+tt-3 / 运维048=2：tt-1 topic 并入+tt-2 / 识别中=1）',
          counts['发布048'] === '2' && counts['运维048'] === '2' && counts['识别中'] === '1', () => JSON.stringify(counts))

        /* ===== ② 多值分组展开 + 标签视图过滤 ===== */
        const groupKids = (label) => h.page.evaluate((lb) => {
          const row = Array.from(document.querySelectorAll('.dsh-notes-tree .dsh-notes-topic-row'))
            .find(r => { const nm = r.querySelector('.dsh-notes-row-nm'); return nm && nm.textContent.trim() === lb })
          const nx = row && row.nextElementSibling
          if (!nx || !nx.classList.contains('dsh-notes-nested')) return []
          return Array.from(nx.querySelectorAll('.dsh-notes-note-ti')).map(el => el.textContent)
        }, label)
        await h.page.locator('.dsh-notes-tree .dsh-notes-topic-row', { hasText: '运维048' }).first().click()
        await H.waitFor(h.page, '「运维048」组展开', async () => (await groupKids('运维048')).length === 2)
        const kidsA = await groupKids('运维048')
        H.t('② 多值分组：「运维048」组 = 纯主题旧版（topic 并入）+ 双标签笔记（tags 命中）',
          kidsA.indexOf('纯主题旧版笔记') >= 0 && kidsA.indexOf('双标签笔记') >= 0, () => JSON.stringify(kidsA))
        await h.page.locator('.dsh-notes-tree .dsh-notes-topic-row', { hasText: '发布048' }).first().click()
        await H.waitFor(h.page, '「发布048」组展开', async () => (await groupKids('发布048')).length === 2)
        const kidsB = await groupKids('发布048')
        H.t('② 多值分组：「发布048」组 = 双标签 + 未分类带标签（一篇可在多组出现；未分类 topic 不成组）',
          kidsB.indexOf('双标签笔记') >= 0 && kidsB.indexOf('未分类带标签笔记') >= 0, () => JSON.stringify(kidsB))

        /* 标签视图过滤：行尾 vfilter → 视图头「标签 · 运维048」，列表只剩 effTag 命中 */
        await h.page.locator('.dsh-notes-tree .dsh-notes-topic-row', { hasText: '运维048' }).locator('.dsh-notes-row-vfilter').first().click()
        await H.waitFor(h.page, '标签视图生效（视图头 标签 · 运维048）', async p =>
          p.evaluate(() => document.querySelector('.dsh-notes-tree').textContent.indexOf('标签 · 运维048') >= 0))
        const viewTitles = await h.page.evaluate(() =>
          Array.from(document.querySelectorAll('.dsh-notes-tree .dsh-notes-note-ti')).map(el => el.textContent))
        H.t('② 标签视图过滤：仅 effTag=运维048 命中（topic-only 旧版在列 = 读侧虚拟合并真机证据；发布048-only 笔记不在列）',
          viewTitles.indexOf('纯主题旧版笔记') >= 0 && viewTitles.indexOf('双标签笔记') >= 0
          && viewTitles.indexOf('未分类带标签笔记') < 0 && viewTitles.indexOf('裸笔记无标签') < 0 && viewTitles.indexOf('分类中占位笔记') < 0,
          () => JSON.stringify(viewTitles))
        await h.page.click('.dsh-notes-tree .dsh-notes-sec-h-clear')   /* × 回全视图 */
        await H.waitFor(h.page, '回全视图（视图头标签行消失）', async p =>
          p.evaluate(() => document.querySelector('.dsh-notes-tree').textContent.indexOf('标签 · 运维048') < 0))

        /* ===== ③ 编辑器 meta：主题 chip 下线 + 标签编辑控件 + 选中折叠 + 面包屑标签段 ===== */
        await h.page.locator('.dsh-notes-note-row', { hasText: '纯主题旧版笔记' }).first().click()
        await h.page.waitForSelector('.dsh-notes-ed-title', { timeout: 8000 })
        await H.waitFor(h.page, 'chips 折叠到位（运维048）', async p =>
          p.evaluate(() => Array.from(document.querySelectorAll('.dsh-notes-tchip')).some(x => x.textContent.indexOf('运维048') >= 0)))
        H.t('③ 主题 chip 已下线（meta 行无 .dsh-notes-meta-topic-input）',
          await h.page.evaluate(() => !document.querySelector('.dsh-notes-meta-topic-input')))
        H.t('③ 标签编辑控件在位：选中折叠 chip「运维048」（topic 折入 chips 真机锁）+ 添加输入框',
          await h.page.evaluate(() => !!document.querySelector('.dsh-notes-tag-add')
            && Array.from(document.querySelectorAll('.dsh-notes-tchip')).some(x => x.textContent.indexOf('运维048') >= 0)))
        const crumb = await h.page.evaluate(() => { const c = document.querySelector('.dsh-notes-ed-crumb'); return c ? c.textContent : '' })
        H.t('③ 面包屑标签段 = 首枚有效标签「运维048」（无「未分类」歧义段）', crumb.indexOf('运维048') >= 0 && crumb.indexOf('未分类') < 0, () => crumb)

        /* ===== ④ 写侧惰性落盘：改标题触发自动保存 → payload topic='' + tags 含折叠值 ===== */
        await h.page.fill('.dsh-notes-ed-title', '纯主题旧版笔记·改')
        await H.waitFor(h.page, 'notes-update 落盘（自动保存防抖后）', async () =>
          h.rpcCalls.some(c => c.method === 'notes-update' && c.args && c.args.id === 'tt-1'), 12000)
        const upd1 = h.rpcCalls.filter(c => c.method === 'notes-update' && c.args.id === 'tt-1').pop().args
        H.t('④ 写侧惰性落盘 payload：topic === ""（清空）+ tags 含折叠值「运维048」（合并去重）',
          upd1.topic === '' && Array.isArray(upd1.tags) && upd1.tags.indexOf('运维048') >= 0, () => JSON.stringify({ topic: upd1.topic, tags: upd1.tags }))
        const st1 = h.state.notes.find(n => n.id === 'tt-1')
        H.t('④ mock state 落盘同步：topic 清空 + tags 并入（懒迁移只发生在保存路径，存量盘从未批量改写）',
          st1.topic === '' && st1.tags.indexOf('运维048') >= 0, () => JSON.stringify({ topic: st1.topic, tags: st1.tags }))

        /* ===== ⑤ 标签编辑控件交互：逗号提交成 chip + ✕ 移除折叠 chip 不回魂 ===== */
        await h.page.click('.dsh-notes-tag-add')
        await h.page.fill('.dsh-notes-tag-add', '新标签048,')
        await H.waitFor(h.page, '「新标签048」提交成 chip', async p =>
          p.evaluate(() => Array.from(document.querySelectorAll('.dsh-notes-tchip')).some(x => x.textContent.indexOf('新标签048') >= 0)))
        H.t('⑤ 标签添加：输入「新标签048,」逗号提交成 chip（在途串并入）', true)
        await H.waitFor(h.page, '新标签随自动保存落盘', async () => {
          const ups = h.rpcCalls.filter(c => c.method === 'notes-update' && c.args && c.args.id === 'tt-1')
          return ups.length > 0 && (ups[ups.length - 1].args.tags || []).indexOf('新标签048') >= 0
        }, 12000)
        H.t('⑤ 新标签随自动保存落盘（payload tags 含 新标签048）', true)
        /* ✕ 移除折叠 chip「运维048」→ tags 删值且 topic 保持清空（移除生效、不回魂） */
        await h.page.locator('.dsh-notes-tchip', { hasText: '运维048' }).locator('.dsh-notes-tchip-x').first().click()
        await H.waitFor(h.page, '「运维048」chip 移除', async p =>
          p.evaluate(() => !Array.from(document.querySelectorAll('.dsh-notes-tchip')).some(x => x.textContent.indexOf('运维048') >= 0)))
        H.t('⑤ ✕ 移除折叠 chip（运维048 从 chips 消失）', true)
        await H.waitFor(h.page, '移除后自动保存落盘', async () => {
          const ups = h.rpcCalls.filter(c => c.method === 'notes-update' && c.args && c.args.id === 'tt-1')
          return ups.length > 0 && (ups[ups.length - 1].args.tags || []).indexOf('运维048') < 0
        }, 12000)
        const upd3 = h.rpcCalls.filter(c => c.method === 'notes-update' && c.args.id === 'tt-1').pop().args
        /* topic 清空只需携带一次（④ 已落盘 ''，edTopic 随保存成功清空）——后续保存不携带（undefined）或仍 ''，均为「不回填」 */
        H.t('⑤ 移除折叠 chip 生效不回魂：payload tags 无「运维048」、保留「新标签048」、topic 不回填（undefined 或仍 ""）',
          upd3.tags.indexOf('运维048') < 0 && upd3.tags.indexOf('新标签048') >= 0 && upd3.topic !== '运维048', () => JSON.stringify({ topic: upd3.topic, tags: upd3.tags }))
        const st3 = h.state.notes.find(n => n.id === 'tt-1')
        H.t('⑤ mock state 终态：tags=[新标签048]、topic 保持清空（移除即消失，懒迁移不回魂）',
          st3.topic === '' && JSON.stringify(st3.tags) === JSON.stringify(['新标签048']), () => JSON.stringify({ topic: st3.topic, tags: st3.tags }))

        H.t('㊷ 全程无 console error / pageerror', h.consoleErrors.length === 0, () => h.consoleErrors.slice(0, 3).join(' | '))
        await H.screenshot(h.page, '42-topic-tag-merge')
      })
    } finally { await h.close() }
  },
}
