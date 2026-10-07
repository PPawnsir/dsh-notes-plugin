// 节 102. 0.4.7 专属会话权限可见性 + preset 按任务覆盖（notes-047-sched-preset，主窗口裁决 A+B 合并 + 改需求：无 inherit）
// 设计定稿（主窗口调研笔记 + 裁决改需求 2026-10-07）：
//   ①schema：schedule 声明增第 10 键 preset——枚举收窄两值 'danger-full-access'|'workspace-write'（无「继承默认」概念——
//     显示层显式化裁决：用户看到的永远是具体档）；空串/null/缺省 = 未声明（存量零迁移，宿主 pinInitialPermission 默认档不动）；
//     非法值写入闸门拒绝（错得安全）；声明比对键扩为十键（declaredAt 重锚口径不变）。
//   ②创建透传：_schedCreateDedicatedSession 在 agents.create + 工作区落账成功后调 permissionPresets.set(handle.agent.session, preset)
//     覆盖 session/created 钉入的默认档；服务缺席静默跳过、set 失败上浮 presetError → _schedFire 成功路径落 lastError
//     观察面（不阻塞派发主链）。孤儿复用路径（handle=null）不补挂（非本轮创建，其权限态归既有轮次）。
//   ③可见性（A 并入 B）：notes-settings-get 响应增带 permissionPresets.defaultPreset（零新 RPC，读不到键整体省略优雅降级）；
//     派发弹窗权限下拉恒两档具体值、预填 = defaultPreset 对应档（读不到兜底完全权限）；勾选专属会话创建时 preset 键总是显式落盘；
//     编辑模式存量 preset 回填优先、存量无键按 defaultPreset 预填显示（保存才显式化——显示层显式化、存储层零迁移）。
// 测试策略：共享 mock 集群（permissionPresetsMock：defaultPreset getter + set 录制 + ppState 故障注入盒）+ 注入时钟
//   （notes-schedule-eval {now}）驱动确定性到期；测试调度用 every≥3d（真实时钟永不到期），后台 tick 零干扰（同节 83/98 口径）；
//   静态包实例（节 17 ctx2 不含 permissionPresets）天然充当「服务缺席」降级演练场。
module.exports = {
  id: "102",
  title: "102. 0.4.7 专属会话权限预设（schedule preset + settings-get defaultPreset + 派发弹窗权限下拉 + 创建透传）",
  async run(H, S) {
  const { t, section, assert, fsNative, path, hostSrc, clientSrc, indexSrc } = H
  const { handlers, sentMessages, ppState, permissionPresetSetCalls } = S
  section('102. 0.4.7 专属会话权限预设（schedule preset + settings-get defaultPreset + 派发弹窗权限下拉 + 创建透传）')
  // 后台 tick 闸沉降（同节 59/81/83/98 口径：防启动补评估与断言交错）
  for (let i = 0; i < 40; i++) {
    const probe = await handlers['notes-schedule-eval']({ now: '2020-01-01T00:00:00.000Z' })
    if (probe && !probe.skipped) break
    await new Promise(r => setTimeout(r, 50))
  }
  const LIVE_SID = 'session-abc12345-0000-0000-0000-000000000000'
  const localIso = (ms) => { const d = new Date(ms); const p = (n) => String(n).padStart(2, '0'); return d.getFullYear() + '-' + p(d.getMonth() + 1) + '-' + p(d.getDate()) + 'T' + p(d.getHours()) + ':' + p(d.getMinutes()) + ':' + p(d.getSeconds()) }

  // ===== ① 闸门：preset 两值枚举（合法过 / 非法拒 / 缺省不落键 / 存量零迁移 / 静态包同口径） =====
  await t('preset 闸门：两值枚举放行、inherit/auto/乱值/非字符串拒绝、缺省零字段兼容（含静态包同口径）', async () => {
    // 两值合法声明 → 放行且落库
    const ok = await handlers['notes-create']({ title: '权限巡检约定', body: 'x', contractType: 'dispatch-schedule', schedule: { every: '3d', target: 'new', preset: 'workspace-write' } })
    assert(ok && ok.id && !ok.error, 'preset=workspace-write 放行（实得 ' + JSON.stringify(ok) + '）')
    const g = await handlers['notes-get']({ id: ok.id })
    assert.strictEqual(g.note.schedule.preset, 'workspace-write', 'preset 落库')
    const ok2 = await handlers['notes-create']({ title: 'x', body: 'x', contractType: 'dispatch-schedule', schedule: { every: '3d', target: 'new', preset: 'danger-full-access' } })
    assert(ok2 && ok2.id && !ok2.error, 'preset=danger-full-access 放行（实得 ' + JSON.stringify(ok2) + '）')
    await handlers['notes-delete']({ id: ok2.id })
    // inherit 拒绝（改需求裁决：枚举收窄两值，无继承概念）
    const inh = await handlers['notes-create']({ title: 'x', body: 'x', contractType: 'dispatch-schedule', schedule: { every: '3d', target: 'new', preset: 'inherit' } })
    assert(inh && inh.error && inh.error.indexOf('preset 非法') >= 0, 'preset=inherit 拒绝（无继承概念，实得 ' + inh.error + '）')
    // auto / 乱值 / 非字符串 → 同闸门拒绝
    const auto = await handlers['notes-create']({ title: 'x', body: 'x', contractType: 'dispatch-schedule', schedule: { every: '3d', target: 'new', preset: 'auto' } })
    assert(auto && auto.error && auto.error.indexOf('preset 非法') >= 0, 'preset=auto 拒绝（保留字非声明档，实得 ' + auto.error + '）')
    const bad = await handlers['notes-create']({ title: 'x', body: 'x', contractType: 'dispatch-schedule', schedule: { every: '3d', target: 'new', preset: 'read-only' } })
    assert(bad && bad.error && bad.error.indexOf('preset 非法') >= 0, 'preset=read-only 拒绝（沙箱档位非权限预设名，实得 ' + bad.error + '）')
    const num = await handlers['notes-create']({ title: 'x', body: 'x', contractType: 'dispatch-schedule', schedule: { every: '3d', target: 'new', preset: 7 } })
    assert(num && num.error && num.error.indexOf('preset 非法') >= 0, 'preset 非字符串拒绝（实得 ' + num.error + '）')
    // 缺省兼容：不带 preset → 放行且零字段（存量形态不变）
    const plain = await handlers['notes-create']({ title: 'x', body: 'x', contractType: 'dispatch-schedule', schedule: { every: '3d', target: 'new' } })
    assert(plain && plain.id && !plain.error, '缺省放行（实得 ' + JSON.stringify(plain) + '）')
    const gp = await handlers['notes-get']({ id: plain.id })
    assert(!('preset' in gp.note.schedule), '缺省零字段落库（存量零迁移）')
    await handlers['notes-delete']({ id: plain.id })
    // 空串/null = 未声明（同 anchor/model 口径）
    const empty = await handlers['notes-create']({ title: 'x', body: 'x', contractType: 'dispatch-schedule', schedule: { every: '3d', target: 'new', preset: '' } })
    assert(empty && empty.id && !empty.error, '空串视为未声明（实得 ' + JSON.stringify(empty) + '）')
    const ge = await handlers['notes-get']({ id: empty.id })
    assert(!('preset' in ge.note.schedule), '空串零字段落库')
    await handlers['notes-delete']({ id: empty.id })
    // 未知字段报错文案键清单同步扩 preset
    const unk = await handlers['notes-create']({ title: 'x', body: 'x', contractType: 'dispatch-schedule', schedule: { every: '3d', target: 'new', hack: 1 } })
    assert(unk && unk.error && unk.error.indexOf('未知字段') >= 0 && unk.error.indexOf('model/provider/preset') >= 0, '未知字段拒绝文案含扩键清单（实得 ' + unk.error + '）')
    // 单次 at + preset + target=new：仍被专属会话闸门拒绝（preset 不改变既有红线）
    const atNew = await handlers['notes-create']({ title: 'x', body: 'x', contractType: 'dispatch-schedule', schedule: { at: localIso(Date.now() + 3600000), target: 'new', preset: 'workspace-write' } })
    assert(atNew && atNew.error && atNew.error.indexOf('仅周期模式') >= 0, 'at+new+preset 仍拒绝（仅周期模式红线不动，实得 ' + atNew.error + '）')
    // 常规 sid 目标声明 preset：惰性键放行（仅 target=new 首触创建消费；同 model/provider 无目标限制先例）
    const inert = await handlers['notes-create']({ title: 'x', body: 'x', contractType: 'dispatch-schedule', schedule: { every: '3d', target: LIVE_SID, preset: 'danger-full-access' } })
    assert(inert && inert.id && !inert.error, '常规 sid + preset 惰性放行（实得 ' + JSON.stringify(inert) + '）')
    await handlers['notes-delete']({ id: inert.id })
    // 静态包同口径（rpc2 → index.mjs 行为）：inherit 拒绝 + 合法放行 + 落库
    const bad2 = await S.rpc2('notes-create', { title: 'x', body: 'x', contractType: 'dispatch-schedule', schedule: { every: '3d', target: 'new', preset: 'inherit' } })
    assert(bad2.body && bad2.body.error && bad2.body.error.indexOf('preset 非法') >= 0, '静态包 inherit 同闸门拒绝（实得 ' + (bad2.body && bad2.body.error) + '）')
    const ok3 = await S.rpc2('notes-create', { title: '静态权限约定', body: 'x', contractType: 'dispatch-schedule', schedule: { every: '3d', target: 'new', preset: 'workspace-write' } })
    assert(ok3.body && ok3.body.id && !ok3.body.error, '静态包合法 preset 放行（实得 ' + JSON.stringify(ok3.body) + '）')
    const g3 = await S.rpc2('notes-get', { id: ok3.body.id })
    assert(g3.body.note.schedule.preset === 'workspace-write', '静态包 preset 落库')
    await S.rpc2('notes-delete', { id: ok3.body.id })
    await handlers['notes-delete']({ id: ok.id })
  })

  // ===== ①·b 声明变更十键：仅 preset 变化 → declaredAt 重锚；等价重提交延续；摘档亦重锚 =====
  await t('声明比对十键：仅 preset 变更刷新 declaredAt（重锚），等价重提交延续（0.4.6-F 口径 0.4.7 扩键）', async () => {
    const c = await handlers['notes-create']({ title: '重锚权限约定', body: 'x', contractType: 'dispatch-schedule', schedule: { every: '3d', target: 'new', preset: 'workspace-write' } })
    assert(c && c.id && !c.error, '创建成功')
    const g1 = await handlers['notes-get']({ id: c.id })
    const d1 = g1.note.schedule.declaredAt
    assert(typeof d1 === 'string' && d1, '首次写入 declaredAt=now（实得 ' + d1 + '）')
    await new Promise(r => setTimeout(r, 30))
    // 等价重提交（声明十键全同）→ declaredAt 延续
    const u1 = await handlers['notes-update']({ id: c.id, schedule: { every: '3d', target: 'new', preset: 'workspace-write' } })
    assert(u1 && !u1.error, '等价重提交放行')
    const g2 = await handlers['notes-get']({ id: c.id })
    assert.strictEqual(g2.note.schedule.declaredAt, d1, '声明未变更延续 declaredAt')
    // 仅改 preset → 声明变更 → 重锚刷新
    await new Promise(r => setTimeout(r, 30))
    const u2 = await handlers['notes-update']({ id: c.id, schedule: { every: '3d', target: 'new', preset: 'danger-full-access' } })
    assert(u2 && !u2.error, '改 preset 放行')
    const g3 = await handlers['notes-get']({ id: c.id })
    assert.strictEqual(g3.note.schedule.preset, 'danger-full-access', 'preset 改写落库')
    assert(g3.note.schedule.declaredAt !== d1 && Date.parse(g3.note.schedule.declaredAt) > Date.parse(d1), '仅 preset 变更触发 declaredAt 重锚（' + d1 + ' → ' + g3.note.schedule.declaredAt + '）')
    // 摘掉 preset → 亦属声明变更 → 重锚
    await new Promise(r => setTimeout(r, 30))
    const u3 = await handlers['notes-update']({ id: c.id, schedule: { every: '3d', target: 'new' } })
    assert(u3 && !u3.error, '摘档放行')
    const g4 = await handlers['notes-get']({ id: c.id })
    assert(!('preset' in g4.note.schedule), '摘档后零字段')
    assert(g4.note.schedule.declaredAt !== g3.note.schedule.declaredAt, '摘档触发重锚')
    await handlers['notes-delete']({ id: c.id })
  })

  // ===== ② 创建透传：声明 preset → permissionPresets.set(会话, 档)；缺省零调用（存量零变化）；set 失败落 lastError 不阻塞 =====
  await t('创建透传：preset=workspace-write → set 以该会话+该名调用；缺省 → set 零调用（存量行为零变化）', async () => {
    const callsBefore = permissionPresetSetCalls.length
    const createsBefore = S.agentCreateCalls.length
    // 声明档位路径
    const c = await handlers['notes-create']({ title: '权限专属约定', body: '巡检载荷', contractType: 'dispatch-schedule', schedule: { every: '3d', target: 'new', preset: 'workspace-write' } })
    assert(c && c.id && !c.error, '创建权限专属调度（实得 ' + JSON.stringify(c) + '）')
    const ev = await handlers['notes-schedule-eval']({ now: new Date(Date.now() + 4 * 86400000).toISOString() })
    assert(ev && !ev.error && ev.errors === 0 && ev.fired >= 1, '首轮评估零故障（实得 ' + JSON.stringify(ev) + '）')
    assert.strictEqual(S.agentCreateCalls.length, createsBefore + 1, 'agents.create 恰调用 1 次')
    const newSid = S.agentCreateCalls[S.agentCreateCalls.length - 1].sessionId
    assert.strictEqual(permissionPresetSetCalls.length, callsBefore + 1, 'permissionPresets.set 恰调用 1 次')
    assert.deepStrictEqual(permissionPresetSetCalls[permissionPresetSetCalls.length - 1], { id: newSid, name: 'workspace-write' }, 'set 以新建会话 + 声明档调用（实得 ' + JSON.stringify(permissionPresetSetCalls[permissionPresetSetCalls.length - 1]) + '）')
    const g = await handlers['notes-get']({ id: c.id })
    assert.strictEqual(g.note.schedule.target, newSid, 'target 回写新 sid（专属会话链路其余不动）')
    assert.strictEqual(g.note.schedule.preset, 'workspace-write', '声明 preset 随机器状态延续保留（回写 target 不丢档）')
    assert(!g.note.schedule.lastError, '成功路径零 lastError')
    assert.strictEqual(sentMessages.filter(m => m.via === 'created:' + newSid).length, 1, '首轮派发直发专属会话（主链不变）')
    await handlers['notes-delete']({ id: c.id })
    S.createdAgents.delete(newSid); S.persistLogs.delete(newSid)
    // 缺省路径（存量零迁移红线）：无 preset 声明 → set 零调用（宿主 pinInitialPermission 默认档不动）
    const c2 = await handlers['notes-create']({ title: '缺省权限约定', body: 'x', contractType: 'dispatch-schedule', schedule: { every: '3d', target: 'new' } })
    assert(c2 && c2.id && !c2.error, '创建缺省专属调度')
    const ev2 = await handlers['notes-schedule-eval']({ now: new Date(Date.now() + 4 * 86400000 + 60000).toISOString() })
    assert(ev2 && ev2.errors === 0, '缺省首轮评估零故障（实得 ' + JSON.stringify(ev2) + '）')
    assert.strictEqual(S.agentCreateCalls.length, createsBefore + 2, '缺省路径新建 1 次')
    assert.strictEqual(permissionPresetSetCalls.length, callsBefore + 1, '缺省声明 → set 零新增调用（存量行为零变化）')
    const defSid = S.agentCreateCalls[S.agentCreateCalls.length - 1].sessionId
    S.createdAgents.delete(defSid); S.persistLogs.delete(defSid)
    await handlers['notes-delete']({ id: c2.id })
  })

  await t('透传降级：set 抛错 → 派发主链成功（lastRun sent + target 回写）+ lastError 落观察面；服务缺席（静态包实例）创建不炸', async () => {
    // set 失败路径：不阻塞派发主链（会话已建成，权限档位失败不毒死任务）
    ppState.failSet = true
    const createsBefore = S.agentCreateCalls.length
    try {
      const c = await handlers['notes-create']({ title: '权限失败约定', body: 'x', contractType: 'dispatch-schedule', schedule: { every: '3d', target: 'new', preset: 'workspace-write' } })
      assert(c && c.id && !c.error, '创建成功')
      const ev = await handlers['notes-schedule-eval']({ now: new Date(Date.now() + 4 * 86400000).toISOString() })
      assert(ev && ev.errors === 0 && ev.fired >= 1, 'set 失败不记 tick 故障（主链成功，实得 ' + JSON.stringify(ev) + '）')
      assert.strictEqual(S.agentCreateCalls.length, createsBefore + 1, '创建照常')
      const g = await handlers['notes-get']({ id: c.id })
      assert(g.note.schedule.lastError && g.note.schedule.lastError.message.indexOf('权限预设挂载失败') >= 0 && g.note.schedule.lastError.message.indexOf('mock permission set failed') >= 0, 'lastError 落 preset 故障观察面（实得 ' + JSON.stringify(g.note.schedule.lastError) + '）')
      assert(g.note.schedule.lastRun && g.note.schedule.lastRun.status === 'sent', 'lastRun sent（派发主链不阻塞）')
      assert(g.note.schedule.lastFiredAt, 'lastFiredAt 正常推进（不重试不毒死任务）')
      assert(/^session-/.test(g.note.schedule.target || ''), 'target 回写新 sid')
      const sid = g.note.schedule.target
      await handlers['notes-delete']({ id: c.id })
      S.createdAgents.delete(sid); S.persistLogs.delete(sid)
    } finally { ppState.failSet = false }
    // 服务缺席路径（静态包实例 = 节 17 ctx2 天然无 permissionPresets）：声明 preset 创建不炸、静默跳过、零 lastError
    const callsBefore = permissionPresetSetCalls.length
    const c2 = await S.rpc2('notes-create', { title: '静态缺服务权限约定', body: 'x', contractType: 'dispatch-schedule', schedule: { every: '3d', target: 'new', preset: 'workspace-write' } })
    assert(c2.body && c2.body.id && !c2.body.error, '静态包创建权限调度（实得 ' + JSON.stringify(c2.body) + '）')
    const ev2 = await S.rpc2('notes-schedule-eval', { now: new Date(Date.now() + 4 * 86400000).toISOString() })
    assert(ev2.body && ev2.body.errors === 0 && ev2.body.fired === 1, '静态包评估零故障恰触发 1 条（实得 ' + JSON.stringify(ev2.body) + '）')
    const g2 = await S.rpc2('notes-get', { id: c2.body.id })
    assert(/^session-/.test(g2.body.note.schedule.target || ''), '服务缺席创建成功回写 sid（静默降级红线：不炸创建）')
    assert(!g2.body.note.schedule.lastError, '服务缺席零 lastError（静默跳过，不留脏键）')
    assert.strictEqual(permissionPresetSetCalls.length, callsBefore, '服务缺席 set 零调用')
    const sid2 = g2.body.note.schedule.target
    S.createdAgents.delete(sid2); S.persistLogs.delete(sid2)
    await S.rpc2('notes-delete', { id: c2.body.id })
  })

  // ===== ③ settings-get 增带 defaultPreset：三态切换 + getter 异常/服务缺席键省略（优雅降级） =====
  await t('settings-get permissionPresets.defaultPreset：档位直读 + 切换跟随 + getter 异常/服务缺席键整体省略', async () => {
    const sg0 = await handlers['notes-settings-get']({})
    assert(sg0 && sg0.permissionPresets && sg0.permissionPresets.defaultPreset === 'danger-full-access', '增带 defaultPreset=danger-full-access（实得 ' + JSON.stringify(sg0.permissionPresets) + '）')
    ppState.defaultPreset = 'workspace-write'
    try {
      const sg1 = await handlers['notes-settings-get']({})
      assert(sg1.permissionPresets && sg1.permissionPresets.defaultPreset === 'workspace-write', '档位切换跟随（用户改默认档 → 弹窗预填数据源同步）')
      // getter 异常 → 键整体省略且主响应不炸（优雅降级红线）
      ppState.defaultPreset = '__throw'
      const sg2 = await handlers['notes-settings-get']({})
      assert(sg2 && !('permissionPresets' in sg2) && !sg2.error, 'getter 异常 → 键省略 + 响应不炸（实得键位 ' + Object.keys(sg2).join(',') + '）')
      // 空值 → 键省略（非法档不进响应）
      ppState.defaultPreset = ''
      const sg3 = await handlers['notes-settings-get']({})
      assert(sg3 && !('permissionPresets' in sg3), '空 defaultPreset → 键省略')
    } finally { ppState.defaultPreset = 'danger-full-access' }
    // 服务缺席（静态包实例 ctx2 无 permissionPresets）→ 键整体省略（旧宿主优雅降级，同 G 卡 setup 契约口径：undefined 即不渲染）
    const sgS = await S.rpc2('notes-settings-get', {})
    assert(sgS.body && !('permissionPresets' in sgS.body) && Array.isArray(sgS.body.models), '静态包服务缺席 → 键省略 + models 通道照常（实得键位 ' + Object.keys(sgS.body).join(',') + '）')
  })

  // ===== ④ UI 双端 + 原型 + 双语：权限下拉锚点（两档具体值/预填逻辑/显式落键/编辑回填防丢档） =====
  await t('UI 锚点双端 + 原型：权限下拉接线（勾专属即显示/两档无继承/defaultPreset 预填/显式落键/编辑回填）+ 双语键', () => {
    const appModal = fsNative.readFileSync(path.join(H.DIR, 'src', 'app', 'modals', 'dispatch.js'), 'utf8')
    const cliModal = fsNative.readFileSync(path.join(H.DIR, 'src', 'client', 'modals', 'dispatch.js'), 'utf8')
    const protoV2Src = fsNative.readFileSync(path.join(H.DIR, 'design', 'notes-ui-v2.html'), 'utf8')
    const zhSrc = fsNative.readFileSync(path.join(H.DIR, 'src', 'i18n', 'zh.js'), 'utf8')
    const enSrc = fsNative.readFileSync(path.join(H.DIR, 'src', 'i18n', 'en.js'), 'utf8')
    // app 派发弹窗：下拉宿主 + 预填 helper + 渲染函数 + 显隐条件 + 确认透传 + 编辑回填
    assert(appModal.indexOf('id="dSchedPresetBox"') >= 0, 'app 权限下拉宿主')
    assert(appModal.indexOf('function schedPresetPrefill(editSched)') >= 0 && appModal.indexOf("return schedPresetCache || 'danger-full-access'") >= 0, 'app 预填 helper（存量优先 + 读不到兜底完全权限）')
    assert(appModal.indexOf('function renderSchedPresetSel()') >= 0 && appModal.indexOf("var show = dState.schedNew && dState.schedMode !== 'once';") >= 0, 'app 下拉显隐（勾专属 + 周期，无清单依赖常显）')
    assert(appModal.indexOf("t('disp.schedPresetFull')") >= 0 && appModal.indexOf("t('disp.schedPresetRestricted')") >= 0 && appModal.indexOf("t('disp.schedPresetTip')") >= 0, 'app 下拉文案走 t()（i18n）')
    assert(appModal.indexOf('res.permissionPresets && res.permissionPresets.defaultPreset') >= 0, 'app defaultPreset 走 notes-settings-get 同通道（零新 RPC）')
    assert(appModal.indexOf("if (dState.schedNew) decl.preset = dState.schedPreset;") >= 0 && appModal.indexOf("else if (editId && dState.editNote.schedule.preset) decl.preset = dState.editNote.schedule.preset;") >= 0, 'app 确认排定显式落键 + 编辑存量防丢档透传')
    assert(appModal.indexOf('schedPreset: schedPresetPrefill(null)') >= 0 && appModal.indexOf('schedPreset: schedPresetPrefill(s)') >= 0, 'app 打开/编辑双入口预填')
    // client 派发弹窗：store 字段 + setter + 预填 + JSX 下拉 + 透传 + 回填
    assert(cliModal.indexOf("schedModel: '', schedModels: [], schedPreset: 'danger-full-access'") >= 0, 'client store 调度字段含 schedPreset（缺省完全权限兜底）')
    assert(cliModal.indexOf('function setDispatchSchedPreset(v)') >= 0 && cliModal.indexOf('function schedPresetPrefill(editSched)') >= 0, 'client setter + 预填 helper')
    assert(cliModal.indexOf('res.permissionPresets && res.permissionPresets.defaultPreset') >= 0, 'client defaultPreset 走 notes-settings-get 同通道')
    assert(cliModal.indexOf("(dispatchSchedNew && dispatchSchedMode !== 'once') ? e('select', { className: 'dsh-notes-dispatch-select dsh-notes-sched-sel', 'data-tooltip': tt('disp.schedPresetTip')") >= 0, 'client 下拉显隐（勾专属 + 周期）')
    assert(cliModal.indexOf("tt('disp.schedPresetFull')") >= 0 && cliModal.indexOf("tt('disp.schedPresetRestricted')") >= 0, 'client 下拉文案走 tt()（i18n）')
    assert(cliModal.indexOf('if (dispatchSchedNew) decl.preset = store.modal.dispatch.get().schedPreset') >= 0 && cliModal.indexOf('else if (dispatchEditId && dispatchEditNote.schedule && dispatchEditNote.schedule.preset) decl.preset = dispatchEditNote.schedule.preset') >= 0, 'client 确认排定显式落键 + 编辑存量防丢档透传')
    assert(cliModal.indexOf('schedPreset: schedPresetPrefill(null)') >= 0 && cliModal.indexOf('schedPreset: schedPresetPrefill(s)') >= 0, 'client 打开/编辑双入口预填')
    // 无「继承默认」选项红线（双端 + 原型，改需求裁决）：下拉恒两档具体值——渲染函数体内 option 恰 2 个且无 inherit 值位
    const appPresetFn = appModal.match(/function renderSchedPresetSel\(\)[\s\S]*?\n\}/)
    assert(appPresetFn && (appPresetFn[0].match(/<option value=/g) || []).length === 2 && appPresetFn[0].indexOf('inherit') < 0, 'app 权限下拉恒两档具体值（无第三档/无 inherit）')
    assert((cliModal.match(/e\('option', \{ value: '(danger-full-access|workspace-write)' \}/g) || []).length === 2 && cliModal.indexOf("value: 'inherit'") < 0 && cliModal.indexOf('schedPresetInherit') < 0, 'client 权限下拉恒两档具体值（无 inherit）')
    const protoPresetFn = protoV2Src.match(/function renderSchedPresetSel\(\)[\s\S]*?\n\}/)
    assert(protoPresetFn && (protoPresetFn[0].match(/<option value=/g) || []).length === 2 && protoPresetFn[0].indexOf('inherit') < 0, '原型权限下拉恒两档具体值（无 inherit）')
    // 原型同步：mock 闸门枚举 + 十键 + 设置响应 + 下拉 + 显式落键 + 演示数据
    assert(protoV2Src.indexOf('function renderSchedPresetSel()') >= 0 && protoV2Src.indexOf('id="dSchedPresetBox"') >= 0, '原型权限下拉接线')
    assert(protoV2Src.indexOf("if (_pr !== 'danger-full-access' && _pr !== 'workspace-write') return { error: 'schedule.preset 非法：'") >= 0, '原型 mock 闸门 preset 枚举校验（同 host）')
    assert(protoV2Src.indexOf("var _dkeys = ['at', 'every', 'anchor', 'dow', 'target', 'action', 'enabled', 'model', 'provider', 'preset']") >= 0, '原型声明比对十键')
    assert(protoV2Src.indexOf("permissionPresets: { defaultPreset: 'danger-full-access' }") >= 0, '原型 mock settings-get 增带 defaultPreset')
    assert(protoV2Src.indexOf('>完全权限（danger-full-access）</option>') >= 0 && protoV2Src.indexOf('>受限（workspace-write）</option>') >= 0, '原型下拉两档静态中文（不双语红线）')
    assert(protoV2Src.indexOf("if (dState.schedNew) decl.preset = dState.schedPreset;") >= 0, '原型确认排定显式落键')
    assert(/id: 'n97'[\s\S]*?target: 'new'[\s\S]*?preset: 'workspace-write'/.test(protoV2Src), '原型演示数据 n97 专属会话 + 权限档位')
    // i18n 双语键
    assert(zhSrc.indexOf("'disp.schedPresetFull': '完全权限（danger-full-access）'") >= 0 && zhSrc.indexOf("'disp.schedPresetRestricted': '受限（workspace-write）'") >= 0 && zhSrc.indexOf("'disp.schedPresetTip'") >= 0, 'zh 字典权限档位三键')
    assert(enSrc.indexOf("'disp.schedPresetFull': 'Full access (danger-full-access)'") >= 0 && enSrc.indexOf("'disp.schedPresetRestricted': 'Restricted (workspace-write)'") >= 0 && enSrc.indexOf("'disp.schedPresetTip'") >= 0, 'en 字典权限档位三键')
    // 发布包产物锚点（build-dist 已跑）
    const clientPkgSrc = fsNative.readFileSync(path.join(H.DIR, 'packages', 'dsh-notes-plugin', 'lib', 'client.js'), 'utf8')
    const appPkgSrc = fsNative.readFileSync(path.join(H.DIR, 'packages', 'dsh-notes-plugin', 'app.html'), 'utf8')
    assert(clientPkgSrc.indexOf('disp.schedPresetFull') >= 0 && clientPkgSrc.indexOf('schedPresetPrefill') >= 0, '发布包 lib/client.js 含权限下拉锚点')
    assert(appPkgSrc.indexOf('id="dSchedPresetBox"') >= 0 && appPkgSrc.indexOf('renderSchedPresetSel') >= 0, '发布包 app.html 含权限下拉锚点')
  })

  // ===== ⑤ host 双包锚点 + 工具描述（host-impl.js + index.mjs 同源断言） =====
  await t('host 双包 + 工具描述锚点：闸门/十键/透传/降级 + note_manage schedule 条目 preset 说明', () => {
    for (const [s, label] of [[hostSrc, 'host-impl'], [indexSrc, 'index.mjs']]) {
      assert(s.indexOf('provider: 1, preset: 1') >= 0, label + ' 已知键清单含 preset')
      assert(s.indexOf("'at', 'every', 'anchor', 'dow', 'target', 'action', 'enabled', 'model', 'provider', 'preset'") >= 0, label + ' 声明比对十键')
      assert(s.indexOf("if (presetRaw !== 'danger-full-access' && presetRaw !== 'workspace-write') return { error: 'schedule.preset 非法：'") >= 0, label + ' preset 两值枚举闸门在位')
      assert(s.indexOf('permissionPresets.set(handle.agent.session, declPreset)') >= 0, label + ' 创建透传 set 调用点在位')
      assert(s.indexOf("ctx.get('permissionPresets')") >= 0, label + ' 软依赖 ctx.get 接入（不进 inject，缺席静默降级）')
      assert(s.indexOf('权限预设挂载失败（派发主链不受影响）：') >= 0, label + ' set 失败 lastError 观察面落点在位')
      assert(s.indexOf('if (pp) out.permissionPresets = pp') >= 0, label + ' settings-get 增带 defaultPreset（缺席键省略）')
    }
    // 工具描述：schedule 形态清单 + 条目说明双包同步（G 卡先例四处同步之第四处）
    assert(hostSrc.indexOf('provider?, model?, preset?') >= 0 && indexSrc.indexOf('provider?, model?, preset?') >= 0, '双包工具描述 schedule 形态清单含 preset')
    assert(hostSrc.indexOf("preset?: \\'danger-full-access\\' | \\'workspace-write\\' (0.4.7: dedicated-session permission preset") >= 0 && indexSrc.indexOf("preset?: \\'danger-full-access\\' | \\'workspace-write\\' (0.4.7: dedicated-session permission preset") >= 0, '双包 schedule 参数描述含 preset 条目')
    assert(hostSrc.indexOf('enabled/model/provider/preset change') >= 0 && indexSrc.indexOf('enabled/model/provider/preset change') >= 0, '双包 declaredAt 重锚字段清单含 preset')
  })
  }
}
