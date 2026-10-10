'use strict'
/* 0.5.0 P2 用例（notes-051-status-race）app 端轮询超时兜底矩阵：
 * ① 超时假象继续拍：重建期 status 一次性 {error}（模拟 rpc 护栏超时落地形态——app 端超时 = 结构化 {error} 同形）→
 *   探针接住（building=true）→ 不报 sticky 继续轮询 → 构建完结按钮复活「构建索引」+ #mErr 全程无 sticky；
 * ② 确认非构建态才报错：status 驻留 {error} 桩（首拍与探针双双失败）→ sticky 报错条「构建索引失败」出现（真失败才报红线保真）。
 * 隔离纪律：finally 清 _vectorStatusErrorOnce/_vectorStatusError/_vectorRebuildDelay 桩 + 语义设置回落，关 context。 */
module.exports = {
  name: '0.5.0 P2 status 轮询超时兜底（app）：一次性 status 报错探针接住继续拍 + 驻留报错探针失败才 sticky',
  async run({ base, browser, H, state }) {
    const page = await H.newPage(browser, base)
    try {
      await H.step(page, '61-status-race', async () => {
        state.settings.semantic = { enabled: true, backend: 'fake-256' }
        await page.click('#btnSettings')
        await page.waitForSelector('#setBody .set-row', { timeout: 8000 })
        await H.waitFor(page, '设置卡落定（语义节渲染，构建按钮可点）', async p => p.evaluate(() => {
          const b = document.querySelector('#setSemBuild')
          return !!(b && b.disabled === false)
        }))

        /* ===== ① 超时假象：一次性 status {error}（重建期护栏超时形态）→ 探针 building=true 接住 → 无 sticky → 完结 ===== */
        state._vectorRebuildDelay = 1200   /* 后台重建节拍桩：拉长观测窗（探针落在 building=true 窗内） */
        state._vectorStatusErrorOnce = '模拟 status 响应超时（e2e 一次性桩）'
        await page.click('#setSemBuild')
        await H.waitFor(page, '构建中态出现（按钮 disabled + 「构建中…」）', async p => p.evaluate(() => {
          const b = document.querySelector('#setSemBuild')
          return !!(b && b.disabled === true && b.textContent.indexOf('构建中') >= 0)
        }), 3000)
        await H.sleep(400)   /* 观测窗中段：一次性桩已被首拍消费 + 探针已接住（mock 后台 1200ms 才完结） */
        H.t('① 一次性 status 报错被探针接住：桩已消费 + 重建仍在跑 + 页面零 sticky 误报（超时假象不报错继续拍）',
          state._vectorStatusErrorOnce === null && state._vectorBuilding === 'fake-256' && await page.evaluate(() => {
            const e = document.querySelector('#mErr')
            return !e || e.style.display === 'none' || !e.textContent
          }), () => JSON.stringify({ once: state._vectorStatusErrorOnce, building: state._vectorBuilding }))
        await H.waitFor(page, '轮询承接成功：按钮复活「构建索引」（超时假象后继续拍至完结）', async p => p.evaluate(() => {
          const b = document.querySelector('#setSemBuild')
          return !!(b && b.disabled === false && b.textContent.indexOf('构建索引') >= 0)
        }), 20000)
        H.t('① 超时假象后构建真完结：按钮复活 + #mErr 无 sticky + mock 侧消旗',
          !state._vectorBuilding && await page.evaluate(() => {
            const e = document.querySelector('#mErr')
            return !e || e.style.display === 'none' || !e.textContent
          }), () => String(state._vectorBuilding))
        await H.screenshot(page, '61-status-race-recover')

        /* ===== ② 确认非构建态才报错：驻留 status {error}（首拍与探针双双失败）→ sticky 报错 ===== */
        state._vectorRebuildDelay = 20
        state._vectorStatusError = '模拟 status 持续故障（e2e 驻留桩）'
        await page.click('#setSemBuild')
        await H.waitFor(page, 'sticky 报错条出现（探针也失败 = 确认故障才报——#mErr 含「构建索引失败」+ 桩原因）', async p => p.evaluate(() => {
          const e = document.querySelector('#mErr')
          return !!(e && e.style.display !== 'none' && e.textContent.indexOf('构建索引失败') >= 0
            && e.textContent.indexOf('持续故障') >= 0)
        }), 20000)
        H.t('② 探针也失败才 sticky 报错：#mErr 含「构建索引失败」+ 桩原因（真失败才报红线保真）', true)
        await H.screenshot(page, '61-status-race-sticky')
      })
    } finally {
      state._vectorStatusErrorOnce = null
      state._vectorStatusError = null
      state._vectorRebuildDelay = undefined
      state._vectorPendingError = ''
      state._vectorBuilding = null
      state.settings.semantic = { enabled: false, backend: 'fake-256' }
      await page.context().close()
    }
  },
}
