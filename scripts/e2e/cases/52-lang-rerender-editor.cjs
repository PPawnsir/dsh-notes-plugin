'use strict'
/* 0.4.9 用例⑳㏠（notes-049-lang-rerender-editor）app 真机锁：语言切换覆盖编辑器区重渲染。
 * 顶栏 🌐 切 EN → 编辑器 footer 状态行（源码模式/创建/更新/来源）+ 反向链接面板即时翻转；
 * 在途编辑保护：dirty 态切语言正文原样（textarea value 不动）；
 * 自动保存落盘后「✓ 已自动保存 HH:MM」→「✓ Autosaved HH:MM」（时刻不变文案翻转）；切回 ZH 还原。
 * ⑤ 驳回补修：EN 持久化 reload → 启动空态编辑器直接英文（静态壳 #ed 滞留中文证伪面真机锁）。
 * 浏览器级对应 check 116（renderEdLang 行为级 eval + 启动本地化 116.3b + 静态锚）。 */
module.exports = {
  name: '⑳㏠ 语言切换编辑器区重渲染：footer/反链即时翻转 + 在途编辑原样（app）',
  async run({ base, browser, H }) {
    const page = await H.newPage(browser, base)
    try {
      await H.step(page, '52-lang-rerender-editor', async () => {
        /* 桩数据：目标页 + 引用页（[[标题]] 反链命中） */
        await H.createNoteViaUI(page, 'e2e语言目标页', '目标正文')
        await H.createNoteViaUI(page, 'e2e语言引用页', '见 [[e2e语言目标页]] 即可')
        await page.click('#tree .note-row:has-text("e2e语言目标页")')
        await page.waitForSelector('#backlinksHost .bl-item', { timeout: 10000 })

        /* ===== ① zh 基线：footer + 反链面板中文 ===== */
        H.t('① zh 基线：footer 源码模式 + 创建/更新/来源中文', await page.evaluate(() => {
          const g = (id) => (document.getElementById(id) || {}).textContent || ''
          return g('footMode') === '源码模式' && g('edCreated').indexOf('创建') === 0
            && g('edUpdated').indexOf('更新') === 0 && g('edSource').indexOf('来源') === 0
        }))
        H.t('① zh 基线：反向链接面板中文 + 命中引用页条目', await page.evaluate(() => {
          const h = document.getElementById('backlinksHost')
          return h && h.textContent.indexOf('反向链接') >= 0 && h.textContent.indexOf('e2e语言引用页') >= 0
        }))

        /* ===== ② 在途 dirty 态切 EN：chrome 即时翻转 + 正文原样 ===== */
        await page.click('#edSrc')
        await page.keyboard.type('在途XYZ')
        const titleBefore = await page.evaluate(() => document.getElementById('edTitle').textContent)
        await page.click('#btnLang')   /* dirty（900ms 窗口内）直切语言 */
        await H.waitFor(page, 'footer 切英（footMode Source mode）', async p =>
          p.evaluate(() => (document.getElementById('footMode') || {}).textContent === 'Source mode'))
        H.t('② 切 EN：footer 全行翻转（Source mode / Created / Updated / Source）', await page.evaluate(() => {
          const g = (id) => (document.getElementById(id) || {}).textContent || ''
          return g('footMode') === 'Source mode' && g('edCreated').indexOf('Created') === 0
            && g('edUpdated').indexOf('Updated') === 0 && g('edSource').indexOf('Source') === 0
        }))
        H.t('② 切 EN：反链面板翻转 Backlinks（命中条目保留）', await page.evaluate(() => {
          const h = document.getElementById('backlinksHost')
          return h.textContent.indexOf('Backlinks') >= 0 && h.textContent.indexOf('反向链接') < 0 && h.textContent.indexOf('e2e语言引用页') >= 0
        }))
        H.t('② 在途编辑原样：textarea 尾部「在途XYZ」+ 标题不动', await page.evaluate(() =>
          document.getElementById('edSrc').value.indexOf('在途XYZ') >= 0) && (await page.evaluate(() => document.getElementById('edTitle').textContent)) === titleBefore)
        H.t('② localStorage 持久化 en', await page.evaluate(() => localStorage.getItem('dsh-notes-lang') === 'en'))

        /* ===== ③ 自动保存落盘：en 态「✓ Autosaved HH:MM」（在途正文随 debounce 落库） ===== */
        await H.waitFor(page, 'en 态已自动保存行出现', async p =>
          p.evaluate(() => ((document.getElementById('edSaved') || {}).textContent || '').indexOf('Autosaved') >= 0), 5000)
        H.t('③ en 态「✓ Autosaved HH:MM」（保存后 footer 同步行翻转）', true)

        /* ===== ④ 切回 ZH：footer/反链还原 + 已自动保存按记账时刻重写 + 正文不动 ===== */
        await page.click('#btnLang')
        await H.waitFor(page, 'footer 切回中文（footMode 源码模式）', async p =>
          p.evaluate(() => (document.getElementById('footMode') || {}).textContent === '源码模式'))
        const zhState = await page.evaluate(() => ({
          mode: document.getElementById('footMode').textContent,
          saved: (document.getElementById('edSaved') || {}).textContent || '',
          bl: document.getElementById('backlinksHost').textContent,
          body: document.getElementById('edSrc').value,
        }))
        H.t('④ 切回 ZH：footer/反链还原 + 「已自动保存」中文（时刻保留）+ 在途正文仍在', zhState.mode === '源码模式'
          && zhState.saved.indexOf('已自动保存') >= 0 && zhState.bl.indexOf('反向链接') >= 0 && zhState.body.indexOf('在途XYZ') >= 0,
          () => JSON.stringify(zhState).slice(0, 160))
        H.t('无 console error / pageerror', page.__consoleErrors.length === 0, () => page.__consoleErrors.slice(0, 3).join(' | '))

        /* ===== ⑤ 驳回补修真机锁：EN 持久化 reload → 启动空态编辑器直接英文（不得滞留中文到手动再切） =====
         * 根面：静态壳 #ed 中文空态 + renderChrome 启动本地化不覆盖 #ed 区 → bootstrap 启动 renderEd() 补修。 */
        await page.click('#btnLang')   /* 持久化 en（reload 后语言态唯一来源 = localStorage） */
        await H.waitFor(page, 'localStorage 持久化 en', async p => p.evaluate(() => localStorage.getItem('dsh-notes-lang') === 'en'))
        await page.reload({ waitUntil: 'load' })
        await page.waitForSelector('#tree', { timeout: 15000 })
        await H.waitFor(page, 'reload 后空态编辑器英文落定', async p =>
          p.evaluate(() => {
            const ed = document.getElementById('ed')
            return ed && ed.className === 'ed empty' && ed.textContent.indexOf('Select a note on the left to view and edit') >= 0
          }))
        const emptyEn = await page.evaluate(() => {
          const ed = document.getElementById('ed')
          return { cls: ed.className, full: ed.textContent, tx: ed.textContent.slice(0, 120) }
        })
        H.t('⑤ EN 持久化 reload：空态编辑器三行英文 + 零中文滞留', emptyEn.cls === 'ed empty'
          && emptyEn.full.indexOf('Select a note on the left to view and edit') >= 0
          && emptyEn.full.indexOf('Concepts at a glance') >= 0
          && emptyEn.full.indexOf('选择左侧一条笔记查看和编辑') < 0 && emptyEn.full.indexOf('概念速览') < 0,
          () => JSON.stringify({ cls: emptyEn.cls, tx: emptyEn.tx }))
        /* 现场清扫：空态直切回 ZH（无笔记打开时语言切换同覆盖——空态分支实时翻转锁） */
        await page.click('#btnLang')
        await H.waitFor(page, '空态切回中文', async p =>
          p.evaluate(() => document.getElementById('ed').textContent.indexOf('选择左侧一条笔记查看和编辑') >= 0))
        H.t('⑤ 空态直切回 ZH：空态编辑器中文还原', true)
        H.t('⑤ reload 段无 console error / pageerror', page.__consoleErrors.length === 0, () => page.__consoleErrors.slice(0, 3).join(' | '))
        await H.screenshot(page, '52-lang-rerender-editor')
      })
    } finally { await page.context().close() }
  },
}
