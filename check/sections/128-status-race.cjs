// 节 128. 0.5.0 P2 重建期 status 轮询拖死竞态修复（notes-051-status-race）
// 实证机理（rebuild-async verifier 真机实测 5012ms 慢日志）：重建在跑（嵌入闸门 _bgeGateChain 单飞被 rebuild 批持续占用）+ 恰好一篇保存落库 →
//   status 的 _vectorDrainNow + await _vectorJobChain 要等 drain，而 drain 的 embed 排在重建当前批之后 → status ≥5s 不回 →
//   双端轮询 rpc 护栏超时 catch → 误报一次「响应超时」。触发场景真实存在：刚编辑完（2s 防抖窗内）就开总开关/点构建。
// 修（双保险）：①host：status 在 building=true 时跳过 _vectorDrainNow() 与 await _vectorJobChain（重建期读旧态即可，
//   pending 计数可略陈旧——跳过 drain 不入队；消旗后下一拍自然恢复精确）；②双端轮询兜底：护栏超时先探一次轻量 status，
//   building 仍真 → 继续轮询不报 sticky；探针也失败/报错 = 确认非构建态故障 → 才报错（app pollProbe / client tick+探针）。
// 断言面：①host 源码锚点（dev/dist 双侧守卫在案 + search 强制 drain 不动红线 + server 双注册契约注释）；
//   ②行为级（假推理缝闸门关闭 + 重建在跑 + 注入保存事件 → status <100ms 返回 = 跳过链等待铁证；消旗后下一拍恢复 drain 语义回归）；
//   ③双端轮询兜底锚（app/client）；④e2e mock status 报错双桩锚；⑤双变体逐字节一致回归。
// 红线：非重建期 status 的强制 drain 语义不动（保存→可搜 <5s 双保险不变）；_vectorPendingErr 双向清零竞态（驳回遗留 b）本卡不治——已入 0.5.x 池。
module.exports = {
  id: "128",
  title: "128. 0.5.0 P2 重建期 status 跳过 drain 链等待 + 双端轮询超时兜底探 building（notes-051-status-race）",
  async run(H, S) {
  const { t, section, assert, fsNative, path, DIR, hostSrc, indexSrc } = H
  section('128. 0.5.0 P2 重建期 status 轮询拖死竞态修复（notes-051-status-race）')
  const read = (p) => fsNative.readFileSync(path.join(DIR, p), 'utf8').replace(/\r\n/g, '\n')
  const vsDev = read('src/host/kernel/vector-store.js')
  const vsDist = read('src/host/kernel/vector-store.dist.js')
  const srvDev = read('src/host/server.js')
  const srvDist = read('src/host/server.dist.js')
  const appSettings = read('src/app/modals/settings.js')
  const cliSettings = read('src/client/modals/settings.js')
  const mockSrc = read('scripts/e2e/server.cjs')

  // ===== 128.1 host 源码锚点（dev/dist 双侧 + server 双注册契约注释）=====
  await t('host P2 源码锚点（dev/dist 双侧）：status building 期跳过 drainNow+链等待（守卫在案）+ search 强制 drain 不动（红线）+ server 契约注释同步', () => {
    for (const [src, tag] of [[vsDev, 'dev'], [vsDist, 'dist']]) {
      const stBody = src.slice(src.indexOf('async function _vectorsStatus()'), src.indexOf('// 检索（notes-vectors-search 入口'))
      assert(stBody.indexOf('if (!_vectorRebuilding) {') >= 0, tag + ' status 重建期守卫在案（building=true 跳过）')
      assert(stBody.indexOf("if (!_vectorRebuilding) {\n          _vectorDrainNow()") >= 0 && stBody.indexOf('await _vectorJobChain\n        }') >= 0, tag + ' 守卫内 = drainNow + 链等待双双跳过（重建期读旧态，pending 可略陈旧）')
      assert(stBody.indexOf('await _vectorFlush()') >= 0, tag + ' flush 保持无条件（写盘单链不占嵌入闸门，不拖慢 status）')
      assert(src.indexOf('0.5.0 P2（notes-051-status-race）') >= 0, tag + ' P2 注释在案（竞态机理 + pending 可略陈旧口径）')
      const srBody = src.slice(src.indexOf('async function _vectorsSearch(args)'))
      assert(srBody.indexOf('_vectorDrainNow()') >= 0 && srBody.indexOf('if (!_vectorRebuilding)') < 0, tag + ' search 强制 drain 语义不动（红线：保存→可搜 <5s 双保险不变）')
      assert(src.indexOf('building: !!_vectorRebuilding') >= 0, tag + ' status building 键在案（P1 契约不动）')
    }
    for (const [src, tag] of [[srvDev, 'server.js'], [srvDist, 'server.dist.js']]) {
      assert(src.indexOf('0.5.0 P2（notes-051-status-race）') >= 0, tag + ' vectors 注册契约注释同步 P2 口径')
    }
    assert(hostSrc.indexOf('if (!_vectorRebuilding) {') >= 0 && indexSrc.indexOf('if (!_vectorRebuilding)') >= 0, '双包拼接产物含 P2 守卫（dev hostSrc / dist index.mjs 源）')
  })

  // ===== 128.2 行为断言（fresh host 实例 + bge 假推理缝闸门——真模型不进 CI；harness 形态同节 127）=====
  const NOTES_DIR_G = DIR + '\\notes'
  const store = new Map()
  const fsMock = {
    resolve: async (p) => p,
    stat: async (p) => { if (p === NOTES_DIR_G) return { dir: true }; if (store.has(p)) return { file: true }; const prefix = p + '\\'; for (const k of store.keys()) if (k.startsWith(prefix)) return { dir: true }; return null },
    listDir: async (p) => { const prefix = p + '\\'; const out = []; for (const k of store.keys()) if (k.startsWith(prefix) && k.indexOf('\\', prefix.length) < 0) out.push({ name: k.slice(prefix.length) }); return out },
    readText: async (p) => { if (!store.has(p)) throw new Error('ENOENT: ' + p); return store.get(p) },
    writeText: async (p, c) => { store.set(p, c) },
  }
  const handlers = {}
  const harnessMock = { handle: (name, fn) => { handlers[name] = fn; return () => { delete handlers[name] } }, defineTool: (d) => d, registerTool: () => () => {} }
  const ctx = {
    fs: fsMock, sandboxPolicy: { resolve: () => ({}) },
    get: (name) => ({ llm: S.llmMock, agentDefaultModel: S.admMock, agents: S.agentsMock, systemPrompt: { context: () => () => {} }, sessionPersistence: S.sessionPersistenceMock, workspaceRegistry: S.workspaceRegistryMock, sessionTitle: S.sessionTitleMock, sessionQuery: S.sessionQueryMock })[name],
    effect: () => {},
  }
  new Function('harness', 'pluginDir', hostSrc)(harnessMock, DIR).apply(ctx)
  // 假推理缝闸门：关闭期嵌入悬挂（status 若等 drain 链则永返不出——快回即跳过链等待铁证）
  let gateOpen = true, inferCalls = 0
  globalThis.__DSH_NOTES_BGE_INFER__ = async (batch) => {
    inferCalls++
    while (!gateOpen) await new Promise(r => setTimeout(r, 10))
    return (batch || []).map(() => { const v = new Array(512).fill(0); v[0] = 1; return v })
  }
  try {
    await t('行为级：闸门关闭+重建在跑+注入保存事件 → status <100ms 返回（跳过链等待）；消旗后下一拍恢复 drain 语义（回归）', async () => {
      // 语义未启用先造数（不入队零成本口径）——排除 drain 防抖干扰，rebuild 唯一嵌入源
      await handlers['notes-create']({ title: 'P2甲', body: '竞态修复正文甲' })
      await handlers['notes-create']({ title: 'P2乙', body: '竞态修复正文乙' })
      await handlers['notes-settings-set']({ semantic: { enabled: true, backend: 'bge-small-zh-q8' } })
      gateOpen = false
      const callsAtStart = inferCalls
      const r1 = await handlers['notes-vectors-rebuild']({ backend: 'bge-small-zh-q8' })
      assert(r1 && r1.ok === true && r1.started === true, '重建 started（P1 后台化形态不动）')
      // 等重建全库扫描落定、首批 embed 悬挂于闸门——此时注入保存 = drain embed 必排重建批后（竞态现场构造）
      for (let i = 0; i < 500 && inferCalls <= callsAtStart; i++) await new Promise(r => setTimeout(r, 10))
      assert(inferCalls > callsAtStart, '重建首批 embed 已悬挂于关闭的闸门（扫描完毕——保存事件必落在重建期）')
      await handlers['notes-create']({ title: 'P2丙', body: '重建期保存正文丙' })   // 保存落库 → 挂起入队（2s 防抖窗内）
      // 修复前：status 的 drainNow 把 drain 挂上链 + await 链 → drain embed 等闸门 → status 拖死（实测 5012ms）；修复后：跳过链等待快回
      const t0 = Date.now()
      const stB = await Promise.race([handlers['notes-vectors-status']({}), new Promise(r => setTimeout(() => r(null), 3000))])
      const dt = Date.now() - t0
      assert(!!stB, 'status 未被 drain 链拖死（3s 护栏内返回——修复前此调用悬挂至闸门开放）')
      assert(dt < 100, 'status <100ms 返回（跳过链等待断言——实得 ' + dt + 'ms）')
      assert(stB && !stB.error, 'status 不报错（实得 ' + JSON.stringify(stB && stB.error) + '）')
      assert(stB && stB.building === true, '重建在跑标记可见（building=true——双端轮询信号源）')
      assert(stB && stB.pending === 1, '重建期读旧态：保存事件挂起可见（pending=1——跳过 drain 不入队口径，实得 ' + (stB && stB.pending) + '）')
      gateOpen = true   // 开闸 → 后台重建落定
      let st = null
      for (let i = 0; i < 500; i++) {
        st = await handlers['notes-vectors-status']({})
        if (st && st.building !== true) break
        await new Promise(r => setTimeout(r, 10))
      }
      assert(st && st.building === false, '开闸后轮询完结：building 消旗')
      assert(st.pending === 0 && st.pendingError === '', '消旗后下一拍 status 恢复 drain 语义：重建期保存已 drain 落索引（pending=0 回归精确，实得 pending=' + (st && st.pending) + '）')
      assert(st.indexed === 3 && st.indexable === 3, '重建期保存笔记入新命名空间索引（indexed=indexable=3，实得 ' + (st && st.indexed) + '/' + (st && st.indexable) + '）')
    })
  } finally { delete globalThis.__DSH_NOTES_BGE_INFER__ }

  // ===== 128.3 双端轮询超时兜底锚（app pollTick/pollProbe + client tick/探针）=====
  await t('双端轮询超时兜底锚：护栏超时先探 building——探针成功按正常一拍承接（building=true 继续拍不报 sticky）；探针也失败才 sticky 报错', () => {
    // app 端（rpc 护栏超时落地为结构化 {error}，与 host 真错误同形难辨 → st.error 先经探针）
    assert(appSettings.indexOf('var pollTick = function (st, n)') >= 0 && appSettings.indexOf('var pollProbe = function (st, n)') >= 0, 'app pollTick/pollProbe 双体在案（拍处理与超时探针分离）')
    assert(appSettings.indexOf("if (st && st.error) { pollProbe(st, n); return; }") >= 0, 'app st.error 不直接 sticky——先经探针')
    assert(appSettings.indexOf("if (st2 && !st2.error) { pollTick(st2, n); return; }") >= 0, 'app 探针成功按正常一拍承接（building=true 继续拍/消旗完结成功态）')
    assert(appSettings.indexOf("rpc('notes-vectors-status', {}).then(function (st) { pollTick(st, n) }, fail)") >= 0, 'app 轮询主拍在案（探针与主拍复用同一 tick）')
    assert(appSettings.indexOf('0.5.0 P2（notes-051-status-race）') >= 0, 'app P2 注释在案')
    // client 端（host.call 护栏超时走 reject → 拒绝分支先探针）
    assert(cliSettings.indexOf('const tick = (st) => {') >= 0, 'client tick 拍处理体在案（正常响应与探针复用）')
    assert(cliSettings.indexOf("host.call('notes-vectors-status', {}).then((st2) => {") >= 0, 'client 超时探针在案（reject 后再发一次轻量 status）')
    assert(cliSettings.indexOf('if (st2 && !st2.error) { tick(st2); return }') >= 0, 'client 探针成功按正常一拍承接')
    assert(cliSettings.indexOf('0.5.0 P2（notes-051-status-race）') >= 0, 'client P2 注释在案')
    // 终态口径不动（P1 契约）：pendingError 真失败才报 + 成功条件 + 节拍上限
    assert(appSettings.indexOf("st.building !== true && (st.pending || 0) === 0) { finish(); return; }") >= 0, 'app 成功条件 = building 消旗且 pending=0（不动）')
    assert(cliSettings.indexOf("st.building !== true && (st.pending || 0) === 0) { setSemBuilding(false); return }") >= 0, 'client 成功条件 = building 消旗且 pending=0（不动）')
    assert(appSettings.indexOf("if (st && st.pendingError) { fail(new Error(String(st.pendingError))); return; }") >= 0 && cliSettings.indexOf("if (st && st.pendingError) { setSemBuilding(false); setError(tt('settings.semanticBuildFailed', { msg: String(st.pendingError) }))") >= 0, '双端 pendingError → sticky（真失败才报红线不动）')
  })

  // ===== 128.4 e2e mock status 报错双桩锚 =====
  await t('e2e mock 同步 status 报错双桩：_vectorStatusError 驻留 + _vectorStatusErrorOnce 一次性（消费即清）——用例 61 数据源', () => {
    assert(mockSrc.indexOf("if (state._vectorStatusError) return { error: String(state._vectorStatusError) }") >= 0, 'mock status 驻留报错桩在案（探针也失败路径）')
    assert(mockSrc.indexOf('state._vectorStatusErrorOnce = null') >= 0, 'mock status 一次性报错桩消费即清（超时假象路径）')
    assert(mockSrc.indexOf('building: !!state._vectorBuilding') >= 0, 'mock status building 键在案（P1 契约不动——探针判定数据源）')
  })

  // ===== 128.5 双变体逐字节一致回归 =====
  await t('双变体逐字节一致回归（P2 改动双侧同步——VECTOR_FLUSH_MS 起切片口径）', () => {
    assert.strictEqual(vsDev.slice(vsDev.indexOf('const VECTOR_FLUSH_MS')), vsDist.slice(vsDist.indexOf('const VECTOR_FLUSH_MS')), 'vector-store dev/dist 逐字节一致（差异仅 VECTORS_PATH 行）')
  })
  }
}
