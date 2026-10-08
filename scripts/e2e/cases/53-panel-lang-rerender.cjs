'use strict'
/* 0.4.9 用例㊽（notes-049-lang-rerender-editor）client 面板真机锁（panel-harness 装载发布版 lib/client.js）：
 * 标题栏语言钮切 EN → 编辑器 footer 状态行（Source mode / Created / Updated）+ 反向链接面板（Backlinks）即时翻转
 * （tt = useT() 订阅 langStore 广播自渲染，零面板改动）；在途编辑保护：dirty 态切语言正文原样；切回 ZH 还原。
 * 桩数据：默认种子 + 1 条「面板语言引用页」（body 含 [[e2e 种子笔记 B]] → 种子 B 反链命中）。 */
const { mountPanel } = require('../panel-harness.cjs')

module.exports = {
  name: '㊽ 面板语言切换编辑器区重渲染：footer/反链即时翻转 + 在途编辑原样（client）',
  async run({ browser, H }) {
    const h = await mountPanel(browser, {
      seed(state) {
        state.notes.unshift({
          id: 'pn-lang-ref-1', title: '面板语言引用页', body: '见 [[e2e 种子笔记 B]] 即可',
          topic: '', kind: 'note', tags: [], status: 'active', inject: false, injectEver: false, injectRole: 'convention',
          injectTo: [], recall: true, sensitive: false, hidden: false, workspace: 'e2e-workspace', folder: '',
          sessionId: '', cwd: '', logDate: '', entities: [], summarizedAt: '', contractType: '', origin: '',
          mergedFrom: [], dispatches: [], refNote: '', runLog: '', useCount: 0, archivedAt: '',
          createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(), deleted: false,
          preview: '见 [[e2e 种子笔记 B]] 即可',
        })
      },
    })
    try {
      await H.step(h.page, '53-panel-lang-rerender', async () => {
        await h.openPanel()
        /* 打开种子笔记 B（源码模式缺省），等正文加载落定 + 反链面板命中 */
        await h.page.evaluate(() => {
          const rows = document.querySelectorAll('.dsh-notes-tree .dsh-notes-note-row')
          for (const r of rows) if (r.textContent.indexOf('e2e 种子笔记 B') >= 0) { r.click(); return }
        })
        await H.waitFor(h.page, '编辑器打开种子笔记 B（textarea 落定回填）', async () =>
          h.page.evaluate(() => { const t = document.querySelector('.dsh-notes-ed-body'); return !!t && !t.readOnly && t.value.indexOf('种子正文 B') >= 0 }))
        await H.waitFor(h.page, '反链面板命中「面板语言引用页」', async () =>
          h.page.evaluate(() => { const bl = document.querySelector('.dsh-notes-backlinks'); return !!bl && bl.textContent.indexOf('面板语言引用页') >= 0 }))

        /* ===== ① zh 基线：footer + 反链面板中文 ===== */
        H.t('① zh 基线：footer 源码模式/创建 + 反链「反向链接」', await h.page.evaluate(() => {
          const foot = (document.querySelector('.dsh-notes-ed-foot') || {}).textContent || ''
          const bl = (document.querySelector('.dsh-notes-backlinks') || {}).textContent || ''
          return foot.indexOf('源码模式') >= 0 && foot.indexOf('创建') >= 0 && bl.indexOf('反向链接') >= 0
        }))

        /* ===== ② 在途 dirty 态切 EN：chrome 即时翻转 + 正文原样 ===== */
        await h.page.evaluate(() => { const t = document.querySelector('.dsh-notes-ed-body'); t.focus(); t.setSelectionRange(t.value.length, t.value.length) })
        await h.page.keyboard.type('在途PN')
        await h.page.click('.dsh-notes-titlebar-actions .dsh-notes-titlebar-btn:has-text("中文")')
        await H.waitFor(h.page, 'footer 切英（Source mode）', async () =>
          h.page.evaluate(() => ((document.querySelector('.dsh-notes-ed-foot') || {}).textContent || '').indexOf('Source mode') >= 0))
        const enState = await h.page.evaluate(() => ({
          foot: (document.querySelector('.dsh-notes-ed-foot') || {}).textContent || '',
          bl: (document.querySelector('.dsh-notes-backlinks') || {}).textContent || '',
          body: (document.querySelector('.dsh-notes-ed-body') || {}).value || '',
        }))
        H.t('② 切 EN：footer 翻转 Source mode / Created + 反链 Backlinks', enState.foot.indexOf('Source mode') >= 0
          && enState.foot.indexOf('Created') >= 0 && enState.bl.indexOf('Backlinks') >= 0 && enState.bl.indexOf('反向链接') < 0,
          () => JSON.stringify(enState).slice(0, 160))
        H.t('② 在途编辑原样：正文尾部「在途PN」保留', enState.body.indexOf('在途PN') >= 0, () => enState.body.slice(-40))
        H.t('② localStorage 持久化 en', await h.page.evaluate(() => localStorage.getItem('dsh-notes-lang') === 'en'))

        /* ===== ③ 切回 ZH：footer/反链还原 + 正文不动 ===== */
        await h.page.click('.dsh-notes-titlebar-actions .dsh-notes-titlebar-btn:has-text("English")')
        await H.waitFor(h.page, 'footer 切回中文（源码模式）', async () =>
          h.page.evaluate(() => ((document.querySelector('.dsh-notes-ed-foot') || {}).textContent || '').indexOf('源码模式') >= 0))
        const zhState = await h.page.evaluate(() => ({
          foot: (document.querySelector('.dsh-notes-ed-foot') || {}).textContent || '',
          bl: (document.querySelector('.dsh-notes-backlinks') || {}).textContent || '',
          body: (document.querySelector('.dsh-notes-ed-body') || {}).value || '',
        }))
        H.t('③ 切回 ZH：footer/反链还原 + 在途正文仍在', zhState.foot.indexOf('源码模式') >= 0
          && zhState.bl.indexOf('反向链接') >= 0 && zhState.body.indexOf('在途PN') >= 0, () => JSON.stringify(zhState).slice(0, 160))
        H.t('无 console error / pageerror', h.consoleErrors.length === 0, () => h.consoleErrors.slice(0, 3).join(' | '))
        await H.screenshot(h.page, '53-panel-lang-rerender')
      })
    } finally {
      await h.close()
    }
  },
}
