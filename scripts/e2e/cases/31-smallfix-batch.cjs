'use strict'
/* 0.4.6-H 用例㉛：小修批五项 e2e 面（notes-046-smallfix；R2 反馈源 n-mux9s42zajxk/n-mux9svn0vhkz/n-mux9rpgowpz6/n-mux9r8hfh7xy/n-mux9tc6z76mj）。
 * 覆盖（host 行为级在 check 节 99，这里走真实 DOM）：
 * ⑤a favicon：<link rel="icon" data:> 在案 + 全程零 /favicon.ico 请求（404 噪音消除）；
 * ④ 嵌套隐身提示行：普通夹下挂 sys 子夹（整节点滤除）→ 父夹展开为空 → .sys-mask-hint 提示行出现；勾「机器」档放行后提示消失、子夹行出现；
 * ③ 选项计数口径：置顶笔记在 sys 夹链内 → 缺省档「置顶」选项计数 0（遮罩对齐命中）；「机器」选项缺省档显「点选加载」占位（不显示 0），勾选后显真实命中数；
 * ② 设置错误可见位：stale 填 -5 点保存 → 校验拦截 + mErr 渲染在标题栏下（DOM 序先于 setBody）+ modal 自动滚回顶部（先压到 400px 再触发，JS click 不自动滚动）；
 * 收尾：全程零 console 错误。 */
module.exports = {
  name: '㉛ 0.4.6-H 小修批：favicon 消噪 + 嵌套隐身提示行 + 选项计数口径 + 设置错误可见位',
  async run({ base, browser, H, state }) {
    const page = await H.newPage(browser, base)
    const rpc = (method, args) => page.evaluate(({ method, args }) =>
      fetch('/dsh-notes', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ method, args }) }).then(r => r.json()), { method, args })
    let seeded = null
    try {
      await H.step(page, '31-smallfix-batch', async () => {
        /* ===== ⑤a favicon：link[rel=icon] data URI 在案 + 重载全程零 favicon.ico 请求 ===== */
        const iconHref = await page.evaluate(() => { const l = document.querySelector('link[rel="icon"]'); return l ? l.getAttribute('href') : null })
        H.t('favicon：<link rel="icon"> data:image/svg+xml 内联在案', !!iconHref && iconHref.indexOf('data:image/svg+xml,') === 0, () => String(iconHref))
        const faviconReqs = []
        page.on('response', r => { if (r.url().indexOf('favicon') >= 0) faviconReqs.push(r.url() + ' → ' + r.status()) })
        await page.reload({ waitUntil: 'load' })
        await page.waitForSelector('#tree', { timeout: 15000 })
        await H.sleep(600)
        H.t('favicon：重载后零 /favicon.ico 请求（404 console 噪音消除）', faviconReqs.length === 0, () => JSON.stringify(faviconReqs))

        /* ===== 造数（RPC 旁路，UI 行为才是断言对象）：普通父夹 + sys 子夹 + sys 夹内置顶笔记 + 未入夹 sys 笔记 ===== */
        const seeded0 = await page.evaluate(async () => {
          const call = (method, args) => fetch('/dsh-notes', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ method, args }) }).then(r => r.json())
          const p = await call('notes-folders', { op: 'create', name: '046H父夹' })
          const c = await call('notes-folders', { op: 'create', name: '046H机器子夹', parent: p.folder.id })
          await call('notes-folders', { op: 'set-flags', id: c.folder.id, sys: true })
          const np = await call('notes-create', { title: '046H置顶在机器夹', body: 'x', status: 'pinned', folder: c.folder.id })
          const ns = await call('notes-create', { title: '046H机器笔记', body: 'x', kind: 'sys' })
          return { parent: p.folder.id, child: c.folder.id, pinNote: np.id, sysNote: ns.id }
        })
        seeded = seeded0
        await page.reload({ waitUntil: 'load' })
        await page.waitForSelector('#tree', { timeout: 15000 })
        await H.waitFor(page, '树渲染出 046H父夹', async p => p.evaluate(() =>
          Array.from(document.querySelectorAll('#tree .row.head[data-fold]')).some(r => r.querySelector('.nm') && r.querySelector('.nm').textContent === '046H父夹')))

        /* ===== ④ 嵌套隐身提示行：缺省档父夹展开为空 → 提示行；sys 子夹行不渲染（遮罩不松绑） ===== */
        /* 夹域求值小工具：046H父夹行 + 紧随 .nested 容器 + 容器内提示行（断言只锁本夹，前序用例种子不串扰） */
        const folderHintState = () => page.evaluate(() => {
          const rows = Array.from(document.querySelectorAll('#tree .row.head[data-fold]'))
          const prow = rows.find(r => r.querySelector('.nm') && r.querySelector('.nm').textContent === '046H父夹')
          const nested = prow && prow.nextElementSibling
          const hint = nested && nested.classList.contains('nested') ? nested.querySelector('.sys-mask-hint') : null
          return {
            hasHint: !!hint && hint.textContent.indexOf('内含机器托管内容') >= 0,
            childRowVisible: rows.some(r => r.querySelector('.nm') && r.querySelector('.nm').textContent === '046H机器子夹'),
            hintText: hint ? hint.textContent : '',
          }
        })
        const hintState = await folderHintState()
        H.t('嵌套隐身：父夹展开为空 → .sys-mask-hint 提示行（内含机器托管内容…）', hintState.hasHint, () => hintState.hintText)
        H.t('嵌套隐身：sys 子夹行仍不渲染（提示 ≠ 遮罩松绑）', hintState.childRowVisible === false)

        /* ===== ③ 选项计数口径：缺省档 置顶=可见置顶数（遮罩对齐，sys 夹链内置顶不计）/ 机器=「点选加载」占位 ===== */
        await page.click('#btnFilter')
        await page.waitForSelector('#fpop.open', { timeout: 8000 })
        /* 期望值独立计算（经 folderSys/folderHidden 存量锚定函数；共享 mock 状态有前序用例种子，不能写绝对值） */
        const expPinned = await page.evaluate(() =>
          notes.filter(n => n.status === 'pinned' && n.hidden !== true && !(n.folder && (folderSys(n.folder) || folderHidden(n.folder)))).length)
        const sysTotal = (await rpc('notes-list', { kind: 'sys' })).notes.length
        const cnt0 = await page.evaluate(() => {
          const cnt = (attr, v) => { const el = document.querySelector('#fpop input[' + attr + '="' + v + '"]'); const s = el && el.closest('label').querySelector('.cnt2'); return s ? s.textContent.trim() : null }
          return { pinned: cnt('data-ft', 'pinned'), sys: cnt('data-fk', 'sys'), note: cnt('data-fk', 'note') }
        })
        H.t('计数口径：缺省档「置顶」选项计数=' + expPinned + '（sys 夹链内置顶被遮罩不计，消「选项 1 vs 命中 0」；旧裸谓词会多计 1）', cnt0.pinned === String(expPinned), () => JSON.stringify(cnt0) + ' 期望 ' + expPinned)
        H.t('计数口径：缺省档「机器」选项显「点选加载」占位（不显示误导性 0）', cnt0.sys === '点选加载', () => JSON.stringify(cnt0))
        H.t('计数口径：note 选项计数为真实可见数（>0）', /^\d+$/.test(cnt0.note || '') && +cnt0.note > 0, () => JSON.stringify(cnt0))

        /* 勾「机器」档 → host kind 通道重拉 → 真实命中数；同时 sys 子夹放行（提示行消失、子夹行出现） */
        await page.click('#fpop input[data-fk="sys"]')
        await H.waitFor(page, '机器档计数变真实命中数 ' + sysTotal, async p => p.evaluate((exp) => {
          const el = document.querySelector('#fpop input[data-fk="sys"]')
          const s = el && el.closest('label').querySelector('.cnt2')
          return !!s && s.textContent.trim() === String(exp)
        }, sysTotal), 8000)
        H.t('计数口径：勾「机器」档后显真实命中数（= host kind 通道全库 sys 数 ' + sysTotal + '）', true)
        await H.waitFor(page, '机器档放行：sys 子夹行渲染 + 本夹提示行消失', async p => p.evaluate(() => {
          const rows = Array.from(document.querySelectorAll('#tree .row.head[data-fold]'))
          const prow = rows.find(r => r.querySelector('.nm') && r.querySelector('.nm').textContent === '046H父夹')
          const nested = prow && prow.nextElementSibling
          const myHint = nested && nested.classList.contains('nested') ? nested.querySelector('.sys-mask-hint') : null
          const childVisible = rows.some(r => r.querySelector('.nm') && r.querySelector('.nm').textContent === '046H机器子夹')
          return childVisible && !myHint
        }), 8000)
        H.t('嵌套隐身：机器档放行后本夹提示行消失、sys 子夹行渲染', true)
        /* 复位：取消机器档（不影响后续用例共享状态口径） */
        await page.click('#fpop input[data-fk="sys"]')
        await H.waitFor(page, '取消机器档后本夹提示行回归', async p => p.evaluate(() => {
          const rows = Array.from(document.querySelectorAll('#tree .row.head[data-fold]'))
          const prow = rows.find(r => r.querySelector('.nm') && r.querySelector('.nm').textContent === '046H父夹')
          const nested = prow && prow.nextElementSibling
          return !!(nested && nested.classList.contains('nested') && nested.querySelector('.sys-mask-hint'))
        }), 8000)
        await page.keyboard.press('Escape')

        /* ===== ② 设置错误可见位：stale=-5 保存 → 校验拦截 + mErr 标题栏下 + modal 自动滚回顶部 ===== */
        await page.click('#btnSettings')
        await page.waitForSelector('#setStale', { timeout: 8000 })
        await page.fill('#setStale', '-5')
        await page.evaluate(() => { document.querySelector('#modal').scrollTop = 400 })   /* 压到底部再触发：JS click 不自动滚动，scrollIntoView 兜底才有意义 */
        await page.evaluate(() => { document.querySelector('#setSave').click() })
        await H.waitFor(page, '校验拦截：mErr 显示非负整数文案', async p => p.evaluate(() => {
          const e = document.querySelector('#mErr')
          return !!e && e.style.display !== 'none' && e.textContent.indexOf('非负整数') >= 0
        }))
        const errPos = await page.evaluate(() => {
          const e = document.querySelector('#mErr'), b = document.querySelector('#setBody'), m = document.querySelector('#modal')
          return {
            domBefore: !!(e.compareDocumentPosition(b) & Node.DOCUMENT_POSITION_FOLLOWING),   /* mErr 在 setBody 之前 */
            errTop: e.getBoundingClientRect().top, modalTop: m.getBoundingClientRect().top,
            scrollTop: m.scrollTop,
            staleStillBad: document.querySelector('#setStale').value,
          }
        })
        H.t('设置错误位：mErr DOM 序在 setBody 之前（标题栏下、保存按钮视野内）', errPos.domBefore)
        H.t('设置错误位：报错后错误区滚进可视区顶部（scrollIntoView 兜底，消「保存无声」）', errPos.scrollTop < 400 && errPos.errTop >= errPos.modalTop - 1 && errPos.errTop < errPos.modalTop + 140, () => JSON.stringify(errPos))
        H.t('设置错误位：校验拦截不落盘且改动保留（控件仍 -5 可继续编辑）', errPos.staleStillBad === '-5', () => errPos.staleStillBad)
        await page.keyboard.press('Escape')

        /* ===== 回归：全程零 console 错误 ===== */
        H.t('全程零 console 错误', page.__consoleErrors.length === 0, () => JSON.stringify(page.__consoleErrors.slice(0, 3)))
      })
    } finally {
      /* 清场：删造数笔记 + 删造数文件夹（mock delete 移出夹内笔记，故先删笔记再删夹） */
      try {
        if (seeded) {
          await rpc('notes-delete', { id: seeded.pinNote })
          await rpc('notes-delete', { id: seeded.sysNote })
          await rpc('notes-folders', { op: 'delete', id: seeded.parent })
        }
      } catch (e) {}
      await page.close().catch(() => {})
    }
  }
}
