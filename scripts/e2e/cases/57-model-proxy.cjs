'use strict'
/* 0.5.0 P0 用例㊽（notes-050-model-proxy → 0.50 R3 notes-051-query-embed 改造）app 端语义构建矩阵：
 * 0.5.0 R3：浏览器嵌入路径整体退役——原 ①②（wasmModelUrl 同源构造 / wasmModelEnsureDownloaded 代理下载 + Cache API 落盘）
 *   随 wasm-embedder.js 删码一并拆除，/dsh-notes-model 代理与 e2e mock 通道同步退役；本卡只留 ③ 构建路由面：
 * ③ 0.5.0 R2（notes-051-save-embed）构建按钮路由：bge 构建 = 调 host notes-vectors-rebuild（RPC 录制断言）——
 *   mock _vectorRebuildError 桩 → 显式「构建索引」失败 → #mErr 驻留「构建索引失败：」含原因（不静默跳回按钮态）；
 *   清桩后再点 → host rebuild 真跑成功 → 状态行「N/M 篇」（存量回填）。
 * 隔离纪律：finally 清 state._vectorRebuildError 与语义设置，关 context。 */
module.exports = {
  name: '㊽ 0.5.0 语义构建（app）：构建按钮 = host rebuild（RPC 录制）+ 失败 sticky 报错 + 清桩回填',
  async run({ base, browser, H, state }) {
    const page = await H.newPage(browser, base)
    try {
      await H.step(page, '57-model-proxy', async () => {
        /* ===== ③ 0.5.0 R2 构建按钮路由（RPC 录制）+ 失败 sticky 报错条 + 成功回填 ===== */
        const rpcLog = []   /* { method, backend } —— 只记 /dsh-notes RPC POST */
        const onRpc = (req) => {
          try {
            if (req.method() !== 'POST' || !/\/dsh-notes$/.test(new URL(req.url()).pathname)) return
            const b = JSON.parse(req.postData() || '{}')
            if (b && b.method) rpcLog.push({ method: b.method, backend: b.args && b.args.backend })
          } catch (e) {}
        }
        page.on('request', onRpc)
        state._vectorRebuildError = '模型未下载（e2e host rebuild 失败桩）'
        state.settings.semantic = { enabled: true, backend: 'bge-small-zh-q8' }
        await page.click('#btnSettings')
        await page.waitForSelector('#setBody .set-row', { timeout: 8000 })
        await H.waitFor(page, '设置卡落定（语义节渲染）', async p => p.evaluate(() => !!document.querySelector('#setSemBuild')))
        await page.click('#setSemBuild')
        await H.waitFor(page, '构建失败 sticky 报错条出现（#mErr 含「构建索引失败」）', async p => p.evaluate(() => {
          const e = document.querySelector('#mErr')
          return !!(e && e.style.display !== 'none' && e.textContent.indexOf('构建索引失败') >= 0)
        }), 20000)
        const err = await page.evaluate(() => {
          const e = document.querySelector('#mErr')
          return { visible: !!(e && e.style.display !== 'none'), text: e ? e.textContent : '' }
        })
        H.t('③ 构建失败 sticky 报错条出现且含原因（「构建索引失败：」+ 失败原因）',
          err.visible && err.text.indexOf('构建索引失败') >= 0 && err.text.indexOf('模型未下载') >= 0, () => JSON.stringify(err))
        H.t('③ R2 路由：bge 构建按钮调 host notes-vectors-rebuild（RPC 录制 backend=bge）',
          rpcLog.some(r => r.method === 'notes-vectors-rebuild' && r.backend === 'bge-small-zh-q8'), () => JSON.stringify(rpcLog))
        /* 清桩再点 → host rebuild 真跑成功 → 状态行「N/M 篇」（存量回填真跑实证） */
        state._vectorRebuildError = undefined
        await page.click('#setSemBuild')
        await H.waitFor(page, '清桩后重建成功：状态行「N/M 篇」', async p => p.evaluate(() => {
          const s = document.querySelector('#setSemStatus')
          return !!(s && /\d+\/\d+ 篇/.test(s.textContent))
        }), 20000)
        const okSt = await page.evaluate(() => document.querySelector('#setSemStatus').textContent.trim())
        H.t('③ host rebuild 真跑：清桩后重建成功，状态行「N/M 篇」（存量回填）', /\d+\/\d+ 篇/.test(okSt), () => okSt)
        page.off('request', onRpc)
        await H.screenshot(page, '57-model-proxy')
      })
    } finally {
      state._vectorRebuildError = undefined
      await page.context().close()
    }
  },
}
