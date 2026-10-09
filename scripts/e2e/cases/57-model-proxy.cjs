'use strict'
/* 0.5.0 P0 用例㊽（notes-050-model-proxy）app 端模型下载 host 代理矩阵：
 * ① 下载走同源：wasmModelUrl 构造 /dsh-notes-model/ 前缀（非 https:// 镜像直连——镜像链迁 host）；
 * ② 实际下载走同源代理成功：wasmModelEnsureDownloaded 全量请求落在 /dsh-notes-model/（零 hf-mirror/huggingface 直连）+ Cache API 落盘 4 文件；
 * ③ 构建失败 sticky 报错条：mock 代理 502 → 显式「构建索引」失败 → #mErr 驻留「构建索引失败：」含原因（不静默跳回按钮态）。
 * 隔离纪律：finally 清 state._modelProxyStatus 与语义设置，关 context。 */
module.exports = {
  name: '㊽ 0.5.0 P0 模型下载 host 代理：下载走同源 + 构建失败 sticky 报错（app）',
  async run({ base, browser, H, state }) {
    const page = await H.newPage(browser, base)
    try {
      await H.step(page, '57-model-proxy', async () => {
        /* ===== ① 下载走同源：wasmModelUrl 构造 ===== */
        const urlCheck = await page.evaluate(() => (typeof wasmModelUrl === 'function') ? wasmModelUrl('config.json') : '')
        H.t('① 下载走同源：wasmModelUrl 返回 /dsh-notes-model/ 前缀（非 https:// 镜像直连）',
          urlCheck.indexOf('/dsh-notes-model/') === 0 && urlCheck.indexOf('https://') < 0 && urlCheck.indexOf('hf-mirror') < 0, () => urlCheck)

        /* ===== ② 实际下载走同源代理成功 + fetch URL 断言 ===== */
        const reqUrls = []
        const onReq = (req) => { const u = req.url(); if (u.indexOf('/dsh-notes-model/') >= 0 || u.indexOf('hf-mirror') >= 0 || u.indexOf('huggingface.co') >= 0) reqUrls.push(u) }
        page.on('request', onReq)
        const dl = await page.evaluate(() => {
          if (typeof wasmModelEnsureDownloaded !== 'function') return { error: 'wasmModelEnsureDownloaded 不可用' }
          return wasmModelEnsureDownloaded(function () {}).then(function (r) { return { ok: r && r.ok, files: r && r.files, bytes: r && r.bytes } }).catch(function (e) { return { error: String(e && e.message || e) } })
        })
        page.off('request', onReq)
        H.t('② 实际下载走同源：全部模型请求落在 /dsh-notes-model/（零 hf-mirror/huggingface 直连）',
          reqUrls.length >= 1 && reqUrls.every(u => u.indexOf('/dsh-notes-model/') >= 0), () => JSON.stringify(reqUrls))
        H.t('② 模型下载成功（mock 代理 200 → Cache API 落盘 4 文件）',
          dl && dl.ok === true && dl.files === 4 && dl.bytes > 0, () => JSON.stringify(dl))

        /* ===== ③ 构建失败 sticky 报错条（含原因，不静默跳回按钮态） ===== */
        state._modelProxyStatus = 502
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
          err.visible && err.text.indexOf('构建索引失败') >= 0, () => JSON.stringify(err))
        await H.screenshot(page, '57-model-proxy')
      })
    } finally {
      state._modelProxyStatus = undefined
      await page.context().close()
    }
  },
}
