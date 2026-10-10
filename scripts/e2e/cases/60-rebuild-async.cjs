'use strict'
/* 0.5.0 P1 用例（notes-051-rebuild-async）app 端 rebuild 后台化矩阵：
 * ① 异步契约实证：rebuild RPC 响应 = { ok, started:true }（无 error、无 indexed——同步窗不再等全量重建完结）；
 * ② 点了 → 立即「构建中」态（按钮 disabled + 「构建中…」）；观测窗中段 mock 侧 _vectorBuilding 仍在跑（RPC 早返、重建未完结）；
 * ③ 构建中二次点击去重：按钮 disabled 拦截 → rebuild 请求计数恒 1（并发双击不重复发起）；
 * ④ 轮询承接成功终态：按钮复活「构建索引」+ 状态行 indexed 爬满（= 非空可索引数——空正文零块不计入 indexed，与 host 同口径）；
 * ⑤ 失败路径：_vectorRebuildError 桩 → RPC 仍 started（不带 error）→ 轮询拾起 status.pendingError → #mErr sticky 报错含原因
 *   （真失败才报；0.5.0 P0 失败驻留语义经轮询路径保真）。
 * 隔离纪律：finally 清 _vectorRebuildDelay/_vectorRebuildError/_vectorPendingError 桩 + 语义设置回落，关 context。 */
module.exports = {
  name: '0.5.0 P1 rebuild 后台化（app）：RPC started 契约 + 构建中态 + 双击去重 + 轮询承接 N/M 满 + 失败 sticky（pendingError 拾起）',
  async run({ base, browser, H, state }) {
    const page = await H.newPage(browser, base)
    try {
      await H.step(page, '60-rebuild-async', async () => {
        state.settings.semantic = { enabled: true, backend: 'fake-256' }
        state._vectorRebuildDelay = 1200   /* 后台重建节拍桩：拉长观测窗（构建中态/后台在跑可断言） */
        /* rebuild RPC 请求计数 + 响应体录制（只记 /dsh-notes 的 notes-vectors-rebuild） */
        const rebuildReqs = []
        const rebuildResp = []
        page.on('request', (req) => {
          try {
            if (req.method() !== 'POST' || !/\/dsh-notes$/.test(new URL(req.url()).pathname)) return
            const b = JSON.parse(req.postData() || '{}')
            if (b && b.method === 'notes-vectors-rebuild') rebuildReqs.push({ backend: b.args && b.args.backend })
          } catch (e) {}
        })
        page.on('response', (res) => {
          try {
            const req = res.request()
            if (req.method() !== 'POST' || !/\/dsh-notes$/.test(new URL(req.url()).pathname)) return
            const b = JSON.parse(req.postData() || '{}')
            if (b && b.method === 'notes-vectors-rebuild') res.json().then(j => rebuildResp.push(j)).catch(() => {})
          } catch (e) {}
        })
        await page.click('#btnSettings')
        await page.waitForSelector('#setBody .set-row', { timeout: 8000 })
        await H.waitFor(page, '设置卡落定（语义节渲染，构建按钮可点）', async p => p.evaluate(() => {
          const b = document.querySelector('#setSemBuild')
          return !!(b && b.disabled === false)
        }))

        /* ===== ①②③ 点击 → started 契约 + 构建中态 + 后台在跑 + 双击去重 ===== */
        await page.click('#setSemBuild')
        await H.waitFor(page, '构建中态立即出现（按钮 disabled + 「构建中…」）', async p => p.evaluate(() => {
          const b = document.querySelector('#setSemBuild')
          return !!(b && b.disabled === true && b.textContent.indexOf('构建中') >= 0)
        }), 3000)
        await H.waitFor(page, 'rebuild RPC 响应落定（录制到响应体）', async () => rebuildResp.length >= 1, 5000)
        H.t('① 异步契约：rebuild RPC 响应 = { ok:true, started:true }（无 error / 无 indexed——同步窗不等全量重建）',
          rebuildResp.length >= 1 && rebuildResp[0].ok === true && rebuildResp[0].started === true
            && !rebuildResp[0].error && typeof rebuildResp[0].indexed === 'undefined',
          () => JSON.stringify(rebuildResp[0]))
        await H.sleep(400)   /* 观测窗中段（mock 后台 1200ms 才完结） */
        H.t('② 后台重建中段：RPC 早返而 mock 侧 _vectorBuilding 仍在跑（重建本体后台化实证）+ 页面无 sticky 误报',
          state._vectorBuilding === 'fake-256' && await page.evaluate(() => {
            const e = document.querySelector('#mErr')
            return !e || e.style.display === 'none' || !e.textContent
          }), () => '_vectorBuilding=' + state._vectorBuilding)
        /* ③ 构建中二次点击：按钮 disabled → el.click() 空放 → rebuild 请求计数恒 1 */
        await page.evaluate(() => { const b = document.querySelector('#setSemBuild'); if (b) b.click() })
        await H.sleep(200)
        H.t('③ 构建中二次点击去重：rebuild 请求计数恒 1（按钮 disabled 拦截，不重复发起）',
          rebuildReqs.length === 1, () => 'rebuild 请求数=' + rebuildReqs.length)

        /* ===== ④ 轮询承接成功终态：按钮复活「构建索引」（building 消旗 = 唯一终态信号——状态行在重建期显示旧命名空间 N/M，
            全量套件共享夹具下旧 build 行会提前命中正则，故等按钮复活再核状态行）+ 状态行 N/N 篇（indexed=indexable 爬满）===== */
        await H.waitFor(page, '轮询承接成功：按钮复活「构建索引」（building 消旗 + pending=0 终态）', async p => p.evaluate(() => {
          const b = document.querySelector('#setSemBuild')
          return !!(b && b.disabled === false && b.textContent.indexOf('构建索引') >= 0)
        }), 20000)
        const okRow = await page.evaluate(() => {
          const s = document.querySelector('#setSemStatus')
          const m = s ? s.textContent.match(/(\d+)\/(\d+) 篇/) : null
          return { status: s ? s.textContent.trim() : '', indexed: m ? +m[1] : -1, indexable: m ? +m[2] : -2 }
        })
        /* 爬满口径：indexed = 可索引且正文非空（空正文零块天然不计入 indexed——与 host _vectorChunks 空正文跳过同口径；
           全量套件共享夹具内有空正文笔记（36 可索引 / 35 入索引），故以 mock state 现算期望值为锚而非 N/N 死板相等） */
        const expectedIndexed = state.notes.filter(n => n.id && n.deleted !== true && n.sensitive !== true && n.kind !== 'sys' && String(n.body || '').length > 0).length
        H.t('④ 轮询承接：按钮复活 + 状态行 indexed 爬满（= 非空可索引数 ' + expectedIndexed + '；空正文零块不计入口径同 host）',
          okRow.indexed >= 1 && okRow.indexed === expectedIndexed, () => JSON.stringify(okRow) + ' / 期望 ' + expectedIndexed)
        H.t('④ 后台真建落定：mock 侧 _vectorBuilding 消旗 + rebuild 请求仍恒 1（全程单次发起）',
          !state._vectorBuilding && rebuildReqs.length === 1, () => 'reqs=' + rebuildReqs.length)
        await H.screenshot(page, '60-rebuild-async')

        /* ===== ⑤ 失败路径：桩 → RPC started（不带 error）→ 轮询拾起 pendingError → sticky 报错含原因 ===== */
        state._vectorRebuildDelay = 20
        state._vectorRebuildError = '模型未下载（e2e 后台重建失败桩）'
        await page.click('#setSemBuild')
        await H.waitFor(page, '失败桩 rebuild RPC 响应落定', async () => rebuildResp.length >= 2, 5000)
        H.t('⑤ 失败路径异步契约：RPC 仍返回 started（响应不带 error——失败经 status.pendingError 轮询拾起）',
          rebuildResp[1] && rebuildResp[1].ok === true && rebuildResp[1].started === true && !rebuildResp[1].error,
          () => JSON.stringify(rebuildResp[1]))
        await H.waitFor(page, '轮询拾起 pendingError：sticky 报错条出现（#mErr 含「构建索引失败」）', async p => p.evaluate(() => {
          const e = document.querySelector('#mErr')
          return !!(e && e.style.display !== 'none' && e.textContent.indexOf('构建索引失败') >= 0)
        }), 20000)
        const errInfo = await page.evaluate(() => {
          const e = document.querySelector('#mErr')
          return { visible: !!(e && e.style.display !== 'none'), text: e ? e.textContent : '' }
        })
        H.t('⑤ 失败 sticky 报错含原因（轮询 pendingError 拾起——真失败才报，不静默跳回按钮态）',
          errInfo.visible && errInfo.text.indexOf('模型未下载') >= 0, () => JSON.stringify(errInfo))
        H.t('⑤ mock 侧失败落键：state._vectorPendingError 带桩原因（与 host _vectorPendingErr 同口径）',
          String(state._vectorPendingError || '').indexOf('模型未下载') >= 0, () => String(state._vectorPendingError))
      })
    } finally {
      state._vectorRebuildDelay = undefined
      state._vectorRebuildError = undefined
      state._vectorPendingError = ''
      state._vectorBuilding = null
      state.settings.semantic = { enabled: false, backend: 'fake-256' }
      await page.context().close()
    }
  },
}
