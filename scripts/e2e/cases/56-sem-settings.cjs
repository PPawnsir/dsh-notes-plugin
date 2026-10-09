'use strict'
/* 0.5.0④ 用例㊺㊼（notes-050-sem-settings）app 端语义检索设置区真机矩阵：
 * ① 语义节渲染：检索与注入组尾 data-sec="semantic" 四控件（总开关 checkbox/后端下拉/状态行/构建按钮）齐
 *   （0.5.0 R3 notes-051-query-embed：模型行随浏览器嵌入路径退役——#setSemModel 不存在为退役锚点）；
 * ② 缺省关零成本：开关 off → 状态行「未启用」+ 构建按钮 disabled；
 * ③ 激活流程自动回填：打开总开关 → enabled+backend 双键整写 + 自动触发 notes-vectors-rebuild → 状态行「N/M 篇」；
 * ④ 关闭开关 → 状态行回落「未启用」（关=文本检索逐字节旧行为）。
 * 隔离纪律：mock state 预置 fake-256 后端（构建走 host rebuild，不触嵌入网络）；finally 关 context。 */
module.exports = {
  name: '㊼ 0.5.0④ 语义检索设置区：渲染/缺省关/激活自动回填/状态行 N/M（app）',
  async run({ base, browser, H, state }) {
    const page = await H.newPage(browser, base)
    try {
      await H.step(page, '56-sem-settings', async () => {
        /* 预置 fake-256 后端（构建走 host rebuild 确定性假 embedder，避免 wasm 网络；host 与 mock 同口径） */
        state.settings.semantic = { enabled: false, backend: 'fake-256' }
        await page.click('#btnSettings')
        await page.waitForSelector('#setBody .set-row', { timeout: 8000 })
        await H.waitFor(page, '设置卡落定（语义节渲染）', async p => p.evaluate(() => !!document.querySelector('#setSemStatus')))

        /* ===== ① 语义节渲染：四控件齐 + 模型行退役（R3）+ 状态行/构建按钮初始态 ===== */
        const render = await page.evaluate(() => {
          const sec = document.querySelector('#setBody .set-row[data-sec="semantic"]')
          return {
            inInjectGroup: !!(sec && sec.closest('.set-group') && sec.closest('.set-group').getAttribute('data-g') === 'inject'),
            chk: !!document.querySelector('#setSemEnabled'),
            sel: !!document.querySelector('#setSemBackend'),
            status: !!document.querySelector('#setSemStatus'),
            build: !!document.querySelector('#setSemBuild'),
            modelGone: !document.querySelector('#setSemModel'),
            statusText: document.querySelector('#setSemStatus').textContent.trim(),
            buildDisabled: document.querySelector('#setSemBuild').disabled,
          }
        })
        H.t('① 语义节渲染：inject 组尾 + 四控件齐（开关/后端/状态行/构建）+ 模型行退役（#setSemModel 不存在）',
          render.inInjectGroup && render.chk && render.sel && render.status && render.build && render.modelGone, () => JSON.stringify(render))
        H.t('② 缺省关零成本：状态行「未启用」+ 构建按钮 disabled',
          render.statusText.indexOf('未启用') >= 0 && render.buildDisabled === true, () => render.statusText + ' / disabled=' + render.buildDisabled)

        /* ===== ③ 激活流程自动回填：打开总开关 → 自动 rebuild → 状态行 N/M 篇 ===== */
        await page.click('#setSemEnabled')
        await H.waitFor(page, '开关打开 → settings.semantic.enabled=true 双键整写', async p => p.evaluate(() => true))
        await H.waitFor(page, '激活自动回填：状态行从「未启用」变「N/M 篇」', async p => p.evaluate(() => {
          const t = document.querySelector('#setSemStatus').textContent
          return t.indexOf('未启用') < 0 && t.indexOf('篇') >= 0
        }), 15000)
        const afterOn = await page.evaluate(() => ({
          chk: document.querySelector('#setSemEnabled').checked,
          status: document.querySelector('#setSemStatus').textContent.trim(),
          buildDisabled: document.querySelector('#setSemBuild').disabled,
        }))
        H.t('③ 激活自动回填：开关 on + 状态行「N/M 篇」（indexed=indexable，存量已回填）',
          afterOn.chk === true && /\d+\/\d+ 篇/.test(afterOn.status) && afterOn.buildDisabled === false, () => JSON.stringify(afterOn))
        const semSetting = state.settings.semantic
        H.t('③ enabled+backend 双键整写（mock 状态：enabled=true 且 backend=fake-256 双键在案）',
          semSetting && semSetting.enabled === true && semSetting.backend === 'fake-256', () => JSON.stringify(semSetting))

        /* ===== ④ 关闭开关 → 状态行回落「未启用」 ===== */
        await page.click('#setSemEnabled')
        await H.waitFor(page, '开关关闭 → 状态行回落「未启用」', async p => p.evaluate(() =>
          document.querySelector('#setSemStatus').textContent.indexOf('未启用') >= 0
            && document.querySelector('#setSemEnabled').checked === false))
        H.t('④ 关闭开关：状态行回落「未启用」+ 开关 off（关=文本检索逐字节旧行为）',
          state.settings.semantic.enabled === false && state.settings.semantic.backend === 'fake-256', () => JSON.stringify(state.settings.semantic))
        await H.screenshot(page, '56-sem-settings')
      })
    } finally {
      await page.context().close()
    }
  },
}
