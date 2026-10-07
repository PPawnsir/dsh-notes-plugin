// 节 98. 0.4.6-G 定时任务专属会话模型档位（notes-046-sched-model）
// 设计定稿（主窗口调研笔记 + 用户提案 n-muwvorr93t1g）：
//   ①schema：schedule 声明增可选 model/provider——成对出现（单给其一拒绝）、非空字符串；
//     合法性不联网校验（创建时 agents.create 失败即 lastError）；声明比对键扩为九键（declaredAt 重锚口径不变）。
//   ②创建透传：declared model/provider → _schedCreateDedicatedSession 的 agents.create agentOptions（覆盖宿主默认选择）；
//     缺省 = 现状默认模型（存量零迁移）；setup commit 契约不动（0.4.5 hotfix 531d29d 教训：setup 必须返回 undefined）。
//   ③UI：派发弹窗调度区模型下拉（数据源 = notes-settings-get models 清单通道，零新 RPC；专属会话复选框勾选才显示；
//     清单缺席下拉隐藏静默降级）；调度任务区/计划块调度行模型标注（有声明才显示）；暂停/恢复透传防丢档（同 anchor/dow 先例）。
// 测试策略：共享 mock 集群（agentCreateCalls 捕获 agentOptions）+ 注入时钟（notes-schedule-eval {now}）驱动确定性到期；
//   测试调度用 every≥3d（真实时钟永不到期），后台 tick 零干扰（同节 83 口径）。
module.exports = {
  id: "98",
  title: "98. 0.4.6-G 定时任务专属会话模型档位（schedule model/provider + 派发弹窗模型下拉 + 创建透传）",
  async run(H, S) {
  const { t, section, assert, fsNative, path, hostSrc, clientSrc, indexSrc } = H
  const { handlers, sentMessages } = S
  section('98. 0.4.6-G 定时任务专属会话模型档位（schedule model/provider + 派发弹窗模型下拉 + 创建透传）')
  // 后台 tick 闸沉降（同节 59/81/83 口径：防启动补评估与断言交错）
  for (let i = 0; i < 40; i++) {
    const probe = await handlers['notes-schedule-eval']({ now: '2020-01-01T00:00:00.000Z' })
    if (probe && !probe.skipped) break
    await new Promise(r => setTimeout(r, 50))
  }
  const LIVE_SID = 'session-abc12345-0000-0000-0000-000000000000'
  const localIso = (ms) => { const d = new Date(ms); const p = (n) => String(n).padStart(2, '0'); return d.getFullYear() + '-' + p(d.getMonth() + 1) + '-' + p(d.getDate()) + 'T' + p(d.getHours()) + ':' + p(d.getMinutes()) + ':' + p(d.getSeconds()) }

  // ===== ① schema 校验：成对/单给拒绝/空白拒绝/非字符串拒绝/缺省兼容 =====
  await t('模型档位闸门：model/provider 成对接受、单给/空白/非字符串拒绝、缺省零字段兼容（含静态包同口径）', async () => {
    // 成对合法声明 → 放行且落库
    const ok = await handlers['notes-create']({ title: '档位巡检约定', body: 'x', contractType: 'dispatch-schedule', schedule: { every: '3d', target: 'new', provider: 'kimi', model: 'kimi-k3' } })
    assert(ok && ok.id && !ok.error, '成对 model+provider 放行（实得 ' + JSON.stringify(ok) + '）')
    const g = await handlers['notes-get']({ id: ok.id })
    assert.strictEqual(g.note.schedule.provider, 'kimi', 'provider 落库')
    assert.strictEqual(g.note.schedule.model, 'kimi-k3', 'model 落库')
    // 空白串（周围空白归一 trim 落库）
    const trim = await handlers['notes-create']({ title: 'x', body: 'x', contractType: 'dispatch-schedule', schedule: { every: '3d', target: 'new', provider: ' px ', model: ' mx ' } })
    assert(trim && trim.id && !trim.error, '周围空白 trim 放行（实得 ' + JSON.stringify(trim) + '）')
    const gt = await handlers['notes-get']({ id: trim.id })
    assert(gt.note.schedule.provider === 'px' && gt.note.schedule.model === 'mx', 'trim 后落库（实得 ' + gt.note.schedule.provider + '/' + gt.note.schedule.model + '）')
    await handlers['notes-delete']({ id: trim.id })
    // 单给其一 → 拒绝（错得安全：能力声明必须无歧义）
    const onlyP = await handlers['notes-create']({ title: 'x', body: 'x', contractType: 'dispatch-schedule', schedule: { every: '3d', target: 'new', provider: 'kimi' } })
    assert(onlyP && onlyP.error && onlyP.error.indexOf('成对出现') >= 0, '单给 provider 拒绝（实得 ' + onlyP.error + '）')
    const onlyM = await handlers['notes-create']({ title: 'x', body: 'x', contractType: 'dispatch-schedule', schedule: { every: '3d', target: 'new', model: 'kimi-k3' } })
    assert(onlyM && onlyM.error && onlyM.error.indexOf('成对出现') >= 0, '单给 model 拒绝（实得 ' + onlyM.error + '）')
    const halfEmpty = await handlers['notes-create']({ title: 'x', body: 'x', contractType: 'dispatch-schedule', schedule: { every: '3d', target: 'new', provider: 'kimi', model: '' } })
    assert(halfEmpty && halfEmpty.error && halfEmpty.error.indexOf('成对出现') >= 0, '一空一实同拒绝（实得 ' + halfEmpty.error + '）')
    // 空白字符串 → 拒绝
    const blank = await handlers['notes-create']({ title: 'x', body: 'x', contractType: 'dispatch-schedule', schedule: { every: '3d', target: 'new', provider: '  ', model: '  ' } })
    assert(blank && blank.error && blank.error.indexOf('空白字符串') >= 0, '空白字符串拒绝（实得 ' + blank.error + '）')
    // 非字符串 → 拒绝
    const num = await handlers['notes-create']({ title: 'x', body: 'x', contractType: 'dispatch-schedule', schedule: { every: '3d', target: 'new', provider: 'kimi', model: 7 } })
    assert(num && num.error && num.error.indexOf('必须是字符串') >= 0, '非字符串拒绝（实得 ' + num.error + '）')
    // 缺省兼容：不带 model/provider → 放行且零字段（存量形态不变）
    const plain = await handlers['notes-create']({ title: 'x', body: 'x', contractType: 'dispatch-schedule', schedule: { every: '3d', target: 'new' } })
    assert(plain && plain.id && !plain.error, '缺省放行（实得 ' + JSON.stringify(plain) + '）')
    const gp = await handlers['notes-get']({ id: plain.id })
    assert(!('model' in gp.note.schedule) && !('provider' in gp.note.schedule), '缺省零字段落库（存量零迁移）')
    await handlers['notes-delete']({ id: plain.id })
    // 空串双给 = 未声明（同 anchor 空串口径）
    const bothEmpty = await handlers['notes-create']({ title: 'x', body: 'x', contractType: 'dispatch-schedule', schedule: { every: '3d', target: 'new', provider: '', model: '' } })
    assert(bothEmpty && bothEmpty.id && !bothEmpty.error, '空串双给视为未声明（实得 ' + JSON.stringify(bothEmpty) + '）')
    await handlers['notes-delete']({ id: bothEmpty.id })
    // 未知字段报错文案仍含「未知字段」且键清单同步扩 model/provider
    const unk = await handlers['notes-create']({ title: 'x', body: 'x', contractType: 'dispatch-schedule', schedule: { every: '3d', target: 'new', hack: 1 } })
    assert(unk && unk.error && unk.error.indexOf('未知字段') >= 0 && unk.error.indexOf('model/provider') >= 0, '未知字段拒绝文案含扩键清单（实得 ' + unk.error + '）')
    // 单次 at + 模型档位：at+target=new 仍被专属会话闸门拒绝（模型档位不改变既有红线）
    const atNew = await handlers['notes-create']({ title: 'x', body: 'x', contractType: 'dispatch-schedule', schedule: { at: localIso(Date.now() + 3600000), target: 'new', provider: 'kimi', model: 'kimi-k3' } })
    assert(atNew && atNew.error && atNew.error.indexOf('仅周期模式') >= 0, 'at+new+档位仍拒绝（仅周期模式红线不动，实得 ' + atNew.error + '）')
    // 静态包同口径（rpc2 → index.mjs 行为）：单给 provider 拒绝 + 成对放行
    const bad2 = await S.rpc2('notes-create', { title: 'x', body: 'x', contractType: 'dispatch-schedule', schedule: { every: '3d', target: 'new', provider: 'kimi' } })
    assert(bad2.body && bad2.body.error && bad2.body.error.indexOf('成对出现') >= 0, '静态包单给 provider 同闸门拒绝（实得 ' + (bad2.body && bad2.body.error) + '）')
    const ok2 = await S.rpc2('notes-create', { title: '静态档位约定', body: 'x', contractType: 'dispatch-schedule', schedule: { every: '3d', target: 'new', provider: 'deepseek', model: 'deepseek-chat' } })
    assert(ok2.body && ok2.body.id && !ok2.body.error, '静态包成对放行（实得 ' + JSON.stringify(ok2.body) + '）')
    const g2 = await S.rpc2('notes-get', { id: ok2.body.id })
    assert(g2.body.note.schedule.provider === 'deepseek' && g2.body.note.schedule.model === 'deepseek-chat', '静态包档位落库')
    await S.rpc2('notes-delete', { id: ok2.body.id })
    await handlers['notes-delete']({ id: ok.id })
  })

  // ===== ①·b 声明变更十键：model/provider 变更触发 declaredAt 重锚，未变更改写延续 =====
  await t('声明比对十键：model/provider 变更刷新 declaredAt（重锚），等价重提交延续（0.4.6-F 口径扩键，0.4.7 扩 preset）', async () => {
    const c = await handlers['notes-create']({ title: '重锚档位约定', body: 'x', contractType: 'dispatch-schedule', schedule: { every: '3d', target: 'new', provider: 'kimi', model: 'kimi-k3' } })
    assert(c && c.id && !c.error, '创建成功')
    const g1 = await handlers['notes-get']({ id: c.id })
    const d1 = g1.note.schedule.declaredAt
    assert(typeof d1 === 'string' && d1, '首次写入 declaredAt=now（实得 ' + d1 + '）')
    await new Promise(r => setTimeout(r, 30))
    // 等价重提交（声明十键全同）→ declaredAt 延续
    const u1 = await handlers['notes-update']({ id: c.id, schedule: { every: '3d', target: 'new', provider: 'kimi', model: 'kimi-k3' } })
    assert(u1 && !u1.error, '等价重提交放行')
    const g2 = await handlers['notes-get']({ id: c.id })
    assert.strictEqual(g2.note.schedule.declaredAt, d1, '声明未变更延续 declaredAt')
    // 仅改 model → 声明变更 → 重锚刷新
    await new Promise(r => setTimeout(r, 30))
    const u2 = await handlers['notes-update']({ id: c.id, schedule: { every: '3d', target: 'new', provider: 'kimi', model: 'kimi-k4' } })
    assert(u2 && !u2.error, '改 model 放行')
    const g3 = await handlers['notes-get']({ id: c.id })
    assert(g3.note.schedule.model === 'kimi-k4' && g3.note.schedule.provider === 'kimi', 'model 改写落库')
    assert(g3.note.schedule.declaredAt !== d1 && Date.parse(g3.note.schedule.declaredAt) > Date.parse(d1), 'model 变更触发 declaredAt 重锚（' + d1 + ' → ' + g3.note.schedule.declaredAt + '）')
    // 摘掉档位（成对缺省）→ 亦属声明变更 → 重锚
    await new Promise(r => setTimeout(r, 30))
    const u3 = await handlers['notes-update']({ id: c.id, schedule: { every: '3d', target: 'new' } })
    assert(u3 && !u3.error, '摘档放行')
    const g4 = await handlers['notes-get']({ id: c.id })
    assert(!('model' in g4.note.schedule) && !('provider' in g4.note.schedule), '摘档后零字段')
    assert(g4.note.schedule.declaredAt !== g3.note.schedule.declaredAt, '摘档触发重锚')
    await handlers['notes-delete']({ id: c.id })
  })

  // ===== ② 创建透传：声明档位 → agentOptions；缺省 = 宿主默认（存量零迁移）；setup commit 契约不动 =====
  await t('创建透传：声明 model/provider 覆盖 agentOptions；缺省跟随宿主默认选择；setup 返回 undefined 契约不破', async () => {
    const createsBefore = S.agentCreateCalls.length
    // 声明档位路径
    const c = await handlers['notes-create']({ title: '档位专属约定', body: '巡检载荷', contractType: 'dispatch-schedule', schedule: { every: '3d', target: 'new', provider: 'kimi', model: 'kimi-k3' } })
    assert(c && c.id && !c.error, '创建档位专属调度（实得 ' + JSON.stringify(c) + '）')
    const ev = await handlers['notes-schedule-eval']({ now: new Date(Date.now() + 4 * 86400000).toISOString() })
    assert(ev && !ev.error && ev.errors === 0 && ev.fired >= 1, '首轮评估零故障（实得 ' + JSON.stringify(ev) + '）')
    assert.strictEqual(S.agentCreateCalls.length, createsBefore + 1, 'agents.create 恰调用 1 次')
    const createOpts = S.agentCreateCalls[S.agentCreateCalls.length - 1]
    assert.deepStrictEqual(createOpts.agentOptions, { provider: 'kimi', model: 'kimi-k3' }, '声明档位透传 agentOptions（实得 ' + JSON.stringify(createOpts.agentOptions) + '）')
    assert(createOpts.meta && createOpts.meta.cwd && createOpts.meta.agentPreset === 'mock-default-preset', 'meta（cwd+preset）形态不变')
    assert.strictEqual(typeof createOpts.setup, 'function', 'setup 回挂在位')
    const setupRet = await createOpts.setup({})
    assert.strictEqual(setupRet, undefined, 'setup commit 契约：返回值必须 undefined（0.4.5 hotfix 531d29d 红线）')
    const newSid = createOpts.sessionId
    const g = await handlers['notes-get']({ id: c.id })
    assert.strictEqual(g.note.schedule.target, newSid, 'target 回写新 sid（专属会话链路其余不动）')
    assert(g.note.schedule.provider === 'kimi' && g.note.schedule.model === 'kimi-k3', '声明档位随机器状态延续保留（回写 target 不丢档）')
    assert.strictEqual(sentMessages.filter(m => m.via === 'created:' + newSid).length, 1, '首轮派发直发专属会话')
    await handlers['notes-delete']({ id: c.id })
    S.createdAgents.delete(newSid); S.persistLogs.delete(newSid)
    // 缺省路径（存量零迁移）：无档位声明 → agentOptions = 宿主当前选择（admMock p/m）
    const c2 = await handlers['notes-create']({ title: '缺省专属约定', body: 'x', contractType: 'dispatch-schedule', schedule: { every: '3d', target: 'new' } })
    assert(c2 && c2.id && !c2.error, '创建缺省专属调度')
    const ev2 = await handlers['notes-schedule-eval']({ now: new Date(Date.now() + 4 * 86400000).toISOString() })
    assert(ev2 && ev2.errors === 0, '缺省首轮评估零故障（实得 ' + JSON.stringify(ev2) + '）')
    assert.strictEqual(S.agentCreateCalls.length, createsBefore + 2, '缺省路径新建 1 次')
    const defOpts = S.agentCreateCalls[S.agentCreateCalls.length - 1]
    assert.deepStrictEqual(defOpts.agentOptions, { provider: 'p', model: 'm' }, '缺省 = adm.currentSelection 宿主默认（存量行为零变化）')
    S.createdAgents.delete(defOpts.sessionId); S.persistLogs.delete(defOpts.sessionId)
    await handlers['notes-delete']({ id: c2.id })
  })

  // ===== ②·b 非法档位：声明期不联网校验，创建失败落 lastError 且不推进 lastFiredAt =====
  await t('非法档位降级：agents.create 失败 → lastError 落盘 + lastFiredAt 不推进（下 tick 重试；声明期零校验红线）', async () => {
    const c = await handlers['notes-create']({ title: '坏档位约定', body: 'x', contractType: 'dispatch-schedule', schedule: { every: '3d', target: 'new', provider: 'ghost', model: 'no-such-model' } })
    assert(c && c.id && !c.error, '坏档位声明期放行（不联网校验红线）')
    const origCreate = S.agentsMock.create
    S.agentsMock.create = async () => { throw new Error('Unknown model: ghost/no-such-model') }
    try {
      const ev = await handlers['notes-schedule-eval']({ now: new Date(Date.now() + 4 * 86400000).toISOString() })
      assert(ev && ev.errors >= 1, '评估记故障（实得 ' + JSON.stringify(ev) + '）')
      const g = await handlers['notes-get']({ id: c.id })
      assert(g.note.schedule.lastError && g.note.schedule.lastError.message.indexOf('agents.create 失败') >= 0 && g.note.schedule.lastError.message.indexOf('Unknown model') >= 0, 'lastError 记录创建失败（实得 ' + JSON.stringify(g.note.schedule.lastError) + '）')
      assert(!g.note.schedule.lastFiredAt, 'lastFiredAt 不推进（下 tick 自动重试）')
      assert.strictEqual(g.note.schedule.target, 'new', 'target 保持 new（创建未成功不回写）')
    } finally { S.agentsMock.create = origCreate }
    // 恢复可用后下 tick 重试成功（同 lastError 恢复语义：失败不毒死任务）
    const ev2 = await handlers['notes-schedule-eval']({ now: new Date(Date.now() + 4 * 86400000 + 60000).toISOString() })
    assert(ev2 && ev2.errors === 0, '恢复后评估零故障（实得 ' + JSON.stringify(ev2) + '）')
    const g2 = await handlers['notes-get']({ id: c.id })
    assert(/^session-/.test(g2.note.schedule.target || ''), '重试创建成功回写 sid')
    assert(!g2.note.schedule.lastError, '成功路径摘除 lastError')
    const sid2 = g2.note.schedule.target
    S.createdAgents.delete(sid2); S.persistLogs.delete(sid2)
    await handlers['notes-delete']({ id: c.id })
  })

  // ===== ③ UI 双端 + 原型静态锚：模型下拉 + 显示标注 + 暂停/恢复透传 =====
  await t('UI 锚点双端 + 原型：模型下拉接线（勾专属才显示/清单缺席隐藏）+ 调度行标注 + 暂停恢复透传', () => {
    const appModal = fsNative.readFileSync(path.join(H.DIR, 'src', 'app', 'modals', 'dispatch.js'), 'utf8')
    const cliModal = fsNative.readFileSync(path.join(H.DIR, 'src', 'client', 'modals', 'dispatch.js'), 'utf8')
    const appInj = fsNative.readFileSync(path.join(H.DIR, 'src', 'app', 'modals', 'inject-manager.js'), 'utf8')
    const appMeta = fsNative.readFileSync(path.join(H.DIR, 'src', 'app', 'panels', 'editor-meta.js'), 'utf8')
    const cliInj = fsNative.readFileSync(path.join(H.DIR, 'src', 'client', 'modals', 'inject-manager.js'), 'utf8')
    const cliEditor = fsNative.readFileSync(path.join(H.DIR, 'src', 'client', 'panels', 'panel', 'editor.js'), 'utf8')
    const protoV2Src = fsNative.readFileSync(path.join(H.DIR, 'design', 'notes-ui-v2.html'), 'utf8')
    const zhSrc = fsNative.readFileSync(path.join(H.DIR, 'src', 'i18n', 'zh.js'), 'utf8')
    const enSrc = fsNative.readFileSync(path.join(H.DIR, 'src', 'i18n', 'en.js'), 'utf8')
    const cssDev = fsNative.readFileSync(path.join(H.DIR, 'src', 'styles.css'), 'utf8')
    const appHead = fsNative.readFileSync(path.join(H.DIR, 'src', 'app', 'shell', 'head.html'), 'utf8')
    // app 派发弹窗：下拉宿主 + 拉取/渲染函数 + 三条件显隐 + 确认透传 + 编辑回填
    assert(appModal.indexOf('id="dSchedModelBox"') >= 0, 'app 模型下拉宿主')
    assert(appModal.indexOf('function pullSchedModels()') >= 0 && appModal.indexOf("rpc('notes-settings-get', {})") >= 0, 'app 模型清单走 notes-settings-get 通道（零新 RPC）')
    assert(appModal.indexOf('function renderSchedModelSel()') >= 0 && appModal.indexOf("dState.schedNew && dState.schedMode !== 'once' && dState.schedModels.length > 0") >= 0, 'app 下拉三条件显隐（勾专属 + 周期 + 清单非空）')
    assert(appModal.indexOf("t('disp.schedModelDefault')") >= 0 && appModal.indexOf("t('disp.schedModelTip'") >= 0, 'app 下拉文案走 t()（i18n）')
    assert(appModal.indexOf("if (dState.schedModel && (dState.schedNew || editId)) { var mp = dState.schedModel.split('/'); decl.provider = mp[0]; decl.model = mp.slice(1).join('/') }") >= 0, 'app 确认排定透传 provider/model（编辑模式保留存量档位防丢档）')
    assert(appModal.indexOf("schedModel: (s.provider && s.model) ? s.provider + '/' + s.model : ''") >= 0, 'app 编辑回填模型档位')
    assert(appModal.indexOf('清单外存量值补合成条目防丢档') >= 0 && appModal.indexOf('!seen[dState.schedModel]') >= 0, 'app 清单外存量值合成条目回显')
    // client 派发弹窗：store 字段 + setter + 拉取 + JSX 下拉 + 透传 + 回填
    assert(cliModal.indexOf("schedNew: false, schedModel: '', schedModels: []") >= 0, 'client store 调度字段含 schedModel/schedModels')
    assert(cliModal.indexOf('function setDispatchSchedModel(v)') >= 0 && cliModal.indexOf('async function loadSchedModels()') >= 0, 'client setter + 清单拉取')
    assert(cliModal.indexOf("host.call('notes-settings-get', {})") >= 0, 'client 模型清单走 notes-settings-get 通道')
    assert(cliModal.indexOf("dispatchSchedNew && dispatchSchedMode !== 'once' && dispatchSchedModels.length > 0") >= 0, 'client 下拉三条件显隐')
    assert(cliModal.indexOf("tt('disp.schedModelDefault')") >= 0 && cliModal.indexOf("tt('disp.schedModelTip'") >= 0, 'client 下拉文案走 tt()（i18n）')
    assert(cliModal.indexOf("if (dispatchSchedModel && (dispatchSchedNew || dispatchEditId)) { const mp = dispatchSchedModel.split('/'); decl.provider = mp[0]; decl.model = mp.slice(1).join('/') }") >= 0, 'client 确认排定透传 provider/model（编辑模式保留存量档位防丢档）')
    // 调度行模型标注四端（有声明才显示）
    assert(appInj.indexOf("class=\"sched-model\"") >= 0 && appInj.indexOf("s.provider && s.model ? '<span class=\"sched-model\"") >= 0, 'app 注入管理调度行模型标注')
    assert(appMeta.indexOf("class=\"sched-model\"") >= 0 && appMeta.indexOf("s.provider && s.model ? '<span class=\"sched-model\"") >= 0, 'app 详情计划块模型标注')
    assert(cliInj.indexOf("className: 'dsh-notes-sched-model dsh-nt'") >= 0, 'client 注入管理调度行模型标注')
    assert(cliEditor.indexOf("className: 'dsh-notes-sched-model dsh-nt'") >= 0, 'client 详情计划块模型标注')
    // 暂停/恢复透传防丢档（双端，同 anchor/dow 先例）
    assert(appInj.indexOf('if (s.provider && s.model) { decl.provider = s.provider; decl.model = s.model }') >= 0, 'app 暂停/恢复保留模型档位')
    assert(cliInj.indexOf('if (s.provider && s.model) { decl.provider = s.provider; decl.model = s.model }') >= 0, 'client 暂停/恢复保留模型档位')
    // 原型同步：闸门 + 下拉 + 标注 + 演示数据（n97 专属会话 + 档位）
    assert(protoV2Src.indexOf('function pullSchedModels()') >= 0 && protoV2Src.indexOf('id="dSchedModelBox"') >= 0, '原型模型下拉接线')
    assert(protoV2Src.indexOf('hasModel !== hasProvider') >= 0 && protoV2Src.indexOf('成对出现') >= 0, '原型 mock 闸门成对校验')
    assert(protoV2Src.indexOf("var _dkeys = ['at', 'every', 'anchor', 'dow', 'target', 'action', 'enabled', 'model', 'provider', 'preset']") >= 0, '原型声明比对十键（0.4.7 扩 preset，notes-047-sched-preset）')
    assert(protoV2Src.indexOf("class=\"sched-model\"") >= 0, '原型调度行模型标注')
    assert(/id: 'n97'[\s\S]*?target: 'new'[\s\S]*?provider: 'kimi', model: 'kimi-k3'/.test(protoV2Src), '原型演示数据 n97 专属会话 + 模型档位')
    // 样式四端（app head.html / client styles.css / 原型）
    assert(appHead.indexOf('.sched-model{') >= 0, 'app 样式 .sched-model')
    assert(cssDev.indexOf('.dsh-notes-sched-model{') >= 0, 'client 样式 .dsh-notes-sched-model')
    assert(protoV2Src.indexOf('.sched-model{') >= 0, '原型样式 .sched-model')
    // i18n 双语键
    assert(zhSrc.indexOf("'disp.schedModelDefault': '默认模型（跟随宿主当前选择）'") >= 0 && zhSrc.indexOf("'disp.schedModelTip': '专属会话模型档位：{model}'") >= 0, 'zh 字典模型档位双键')
    assert(enSrc.indexOf("'disp.schedModelDefault': 'Default model (follow host selection)'") >= 0 && enSrc.indexOf("'disp.schedModelTip': 'Dedicated session model: {model}'") >= 0, 'en 字典模型档位双键')
    // 发布包产物锚点（build-dist 已跑）
    const clientPkgSrc = fsNative.readFileSync(path.join(H.DIR, 'packages', 'dsh-notes-plugin', 'lib', 'client.js'), 'utf8')
    const appPkgSrc = fsNative.readFileSync(path.join(H.DIR, 'packages', 'dsh-notes-plugin', 'app.html'), 'utf8')
    const cssPkg = fsNative.readFileSync(path.join(H.DIR, 'packages', 'dsh-notes-plugin', 'lib', 'styles.css'), 'utf8')
    assert(clientPkgSrc.indexOf('disp.schedModelDefault') >= 0 && clientPkgSrc.indexOf('dsh-notes-sched-model') >= 0, '发布包 lib/client.js 含模型下拉/标注锚点')
    assert(appPkgSrc.indexOf('id="dSchedModelBox"') >= 0 && appPkgSrc.indexOf('class="sched-model"') >= 0, '发布包 app.html 含下拉/标注锚点')
    assert(cssPkg.indexOf('.dsh-notes-sched-model{') >= 0, '发布包 lib/styles.css 含模型标注样式')
  })

  // ===== ④ host 双包锚点 + 工具描述（index.js±dist → host-impl.js + index.mjs） =====
  await t('host 双包 + 工具描述锚点：闸门/透传/十键/缺省回落 + note_manage schedule 条目 model/provider 说明', () => {
    for (const [s, label] of [[hostSrc, 'host-impl'], [indexSrc, 'index.mjs']]) {
      assert(s.indexOf('hasModel !== hasProvider') >= 0 && s.indexOf('schedule.model 与 schedule.provider 必须成对出现') >= 0, label + ' 成对校验闸门在位')
      assert(s.indexOf('model: 1, provider: 1, preset: 1') >= 0, label + ' 已知键清单含 model/provider/preset（0.4.7 扩键）')
      assert(s.indexOf("'at', 'every', 'anchor', 'dow', 'target', 'action', 'enabled', 'model', 'provider', 'preset'") >= 0, label + ' 声明比对十键（0.4.7 扩 preset）')
      assert(s.indexOf('const declSel = (function ()') >= 0 && s.indexOf('const sel = declSel || (adm') >= 0, label + ' 创建透传：声明档位优先 + 缺省回落 adm')
      assert(s.indexOf('agentOptions: sel ? { provider: sel.provider, model: sel.model } : {}') >= 0, label + ' agentOptions 形态不变')
      // 0.4.5 热修锚回归（动 agents.create 调用面后 setup 契约不动）
      assert(s.indexOf('setup: async function (agentCtx) { await agentPresets.mount(agentCtx, presetId) }') >= 0, label + ' setup commit 契约在位（返回 undefined）')
      assert(s.indexOf('return agentPresets.mount(agentCtx, presetId)') < 0, label + ' 旧 commit 炸点写法未回归')
    }
    // 工具描述：schedule 条目双包补 model/provider 字段说明
    assert(hostSrc.indexOf('provider?: + model?: dedicated-session model pair') >= 0, 'host-impl 工具 schedule 参数描述含档位说明')
    assert(indexSrc.indexOf('provider?: + model?: dedicated-session model pair') >= 0, 'index.mjs 工具 schedule 参数描述含档位说明')
    assert(hostSrc.indexOf('declare BOTH or NEITHER') >= 0 && indexSrc.indexOf('declare BOTH or NEITHER') >= 0, '双包工具描述成对红线说明')
    assert(hostSrc.indexOf('anchor?, dow?, provider?, model?') >= 0 && indexSrc.indexOf('anchor?, dow?, provider?, model?') >= 0, '双包工具描述 schedule 形态清单含 provider/model')
  })
  }
}
