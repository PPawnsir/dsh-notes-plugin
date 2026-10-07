// 节 105. 0.4.7-A 扫尾断言批（notes-047-cleanup：八项小修 + 第⑨项体检超时热修）
// 覆盖：
//   ①工具描述摘要串口径滞后：「anchored at lastFiredAt||createdAt」→ lastFiredAt||declaredAt||createdAt（0.4.6-F 重锚口径，双包静态锚 + 旧串清零）；
//   ②文案残留三处（settings.memEnableTip 字段名残留 / editor.richDisabled「白名单外语法」/ inj.sensTip「键保留值遮蔽」）——
//     按 0.4.6-D「先讲后果」口径双语改写（eval 真码：字典求值 + 术语/字段名清零双向断言）；
//   ④注入管理行内「设为约定」confirm 闸（0.4.6-E verifier 残留）：四端静态锚 + app doInjMgrSet 提取 eval 真码
//     （dismiss 零副作用 / accept 才发 notes-update / 切 off 不弹闸）；e2e 行为演练见用例⑪；
//   ⑥workspace backfill 噪音（用户活机钓出）：skip 明细聚合一行汇总 + sessionId 缺席先试笔记自身 cwd（workspaceRegistry 精确匹配）
//     + 不可推导记账 telemetry.json meta.wsBackfillSkip 幂等跳过——静态包冷实例行为级（两轮启动：一轮修复+记账，二轮零重扫零逐行日志）；
//   ⑨体检超时 8s→120s（主窗口追加，用户实测 8.7s 被打断）：超时常量/错误文案/UI 在途态锚在节 90，本节目录注记。
module.exports = {
  id: "105",
  title: "105. 0.4.7-A 扫尾断言批（描述口径/文案残留/行内约定确认闸/backfill 降噪幂等）",
  async run(H, S) {
  const { t, section, assert, fsNative, path, osNative, pathToFileURL, DIR, hostSrc, clientSrc, indexSrc } = H
  const { appSrc, clientPkgSrc, protoV2Src } = S
  section('105. 0.4.7-A 扫尾断言批（描述口径/文案残留/行内约定确认闸/backfill 降噪幂等）')

  // ===== ① 工具描述摘要串：0.4.6-F 重锚口径同步（dev 拼接产物 + 发布包 index.mjs 双锚 + 旧串清零） =====
  await t('0.4.7-A① 工具描述摘要串：无 anchor 声明锚点 = lastFiredAt||declaredAt||createdAt（双包 + 旧口径串清零）', () => {
    for (const [s, tag] of [[hostSrc, 'host-impl（dev 拼接）'], [indexSrc, 'index.mjs（发布包）']]) {
      assert(s.indexOf('anchored at lastFiredAt||declaredAt||createdAt') >= 0, tag + ' note_manage 描述含 0.4.6-F 重锚口径')
      assert(s.indexOf('anchored at lastFiredAt||createdAt') < 0, tag + ' 旧滞后口径串已清零')
    }
  })

  // ===== ② 文案残留三处：eval 真码（字典求值）——先讲后果口径 + 术语/字段名残留清零（双语） =====
  await t('0.4.7-A② 文案残留三处双语改写：memEnableTip 字段名清零 / richDisabled 消「白名单外语法」/ sensTip 消「键保留值遮蔽」', () => {
    const grab = (f, v) => new Function(fsNative.readFileSync(path.join(DIR, 'src', 'i18n', f), 'utf8') + '\nreturn ' + v)()
    const zh = grab('zh.js', 'I18N_ZH'), en = grab('en.js', 'I18N_EN')
    // settings.memEnableTip：内部字段名（inject=true / contractType / kind=log）不外露；后果先行（任务收尾自动沉淀工作日志）
    assert(zh['settings.memEnableTip'].indexOf('工作日志') >= 0 && zh['settings.memEnableTip'].indexOf('任务收尾') >= 0, 'zh memEnableTip 先讲后果（实得 ' + zh['settings.memEnableTip'] + '）')
    for (const bad of ['inject=true', 'contractType', 'kind=log', 'memory-guide']) {
      assert(zh['settings.memEnableTip'].indexOf(bad) < 0, 'zh memEnableTip 字段名残留清零：' + bad)
      assert(en['settings.memEnableTip'].indexOf(bad) < 0, 'en memEnableTip 字段名残留清零：' + bad)
    }
    assert(en['settings.memEnableTip'].indexOf('work log') >= 0, 'en memEnableTip 同款（实得 ' + en['settings.memEnableTip'] + '）')
    // editor.richDisabled：「白名单外语法」术语清零；讲清后果（退回纯文本、内容无损）
    assert(zh['editor.richDisabled'].indexOf('白名单') < 0 && zh['editor.richDisabled'].indexOf('内容不受影响') >= 0, 'zh richDisabled 消术语 + 后果口径（实得 ' + zh['editor.richDisabled'] + '）')
    assert(en['editor.richDisabled'].toLowerCase().indexOf('whitelist') < 0 && en['editor.richDisabled'].indexOf('content unchanged') >= 0, 'en richDisabled 同款（实得 ' + en['editor.richDisabled'] + '）')
    // inj.sensTip：「键保留值遮蔽」黑话清零；人话 = 字段名保留、值隐藏为 ****** + note_get 调取
    assert(zh['inj.sensTip'].indexOf('键保留值遮蔽') < 0 && zh['inj.sensTip'].indexOf('字段名保留') >= 0 && zh['inj.sensTip'].indexOf('note_get') >= 0, 'zh sensTip 消黑话（实得 ' + zh['inj.sensTip'] + '）')
    assert(en['inj.sensTip'].indexOf('keys kept, values hidden') < 0 && en['inj.sensTip'].indexOf('note_get') >= 0, 'en sensTip 同款（实得 ' + en['inj.sensTip'] + '）')
  })

  // ===== ④ 行内「设为约定」confirm 闸：四端静态锚 =====
  await t('0.4.7-A④ 行内「设为约定」confirm 闸四端锚：client/app/原型源 + 双发布产物', () => {
    const appModalSrc = fsNative.readFileSync(path.join(DIR, 'src', 'app', 'modals', 'inject-manager.js'), 'utf8')
    const cliModalSrc = fsNative.readFileSync(path.join(DIR, 'src', 'client', 'modals', 'inject-manager.js'), 'utf8')
    assert(cliModalSrc.indexOf("role === 'convention' && !window.confirm(t('meta.convInjectConfirm'") >= 0, 'client doInjMgrSet 行内约定闸（与详情区同文案键）')
    assert(appModalSrc.indexOf("role === 'convention' && !confirm(t('meta.convInjectConfirm'") >= 0, 'app doInjMgrSet 行内约定闸')
    assert(protoV2Src.indexOf("role === 'convention' && !confirm('设为约定：《'") >= 0, '原型行内约定闸（静态中文红线同步）')
    assert(clientPkgSrc.indexOf("role === 'convention' && !window.confirm(t('meta.convInjectConfirm'") >= 0, '发布包 lib/client.js 行内约定闸（需先跑 build-dist）')
    assert(appSrc.indexOf("role === 'convention' && !confirm(t('meta.convInjectConfirm'") >= 0, '发布包 app.html 行内约定闸')
  })

  // ===== ④ eval 真码：app doInjMgrSet 提取 eval——dismiss 零副作用 / accept 才发 notes-update / 切 off 不弹闸 =====
  await t('0.4.7-A④ eval 真码：app doInjMgrSet confirm 拦截/放行/免闸三路径', async () => {
    const src = fsNative.readFileSync(path.join(DIR, 'src', 'app', 'modals', 'inject-manager.js'), 'utf8')
    /* 0.4.7-B④b：doInjMgrSet 落盘段抽为 injMgrSetDirect（挂载框「仅切换角色」跳过档共用）——eval 提取须连带 */
    const m = src.match(/function doInjMgrSet\(n, role\) \{[\s\S]*?\n\}\n\/\*[\s\S]*?\*\/\nfunction injMgrSetDirect\(n, role\) \{[\s\S]*?\n\}/)
    assert(m, 'app doInjMgrSet + injMgrSetDirect 可提取（eval 真码）')
    const confirmCalls = [], rpcCalls = []
    const ctx = {
      injMgrState: { pending: false },
      injMgrRole: (n) => (n.inject === true ? (n.injectRole === 'reference' ? 'reference' : 'convention') : 'off'),
      openMountModal: () => { throw new Error('不应进挂载分支') },
      confirm: (msg) => { confirmCalls.push(msg); return ctx.__ret },
      t: (k, vars) => k + ' ' + JSON.stringify(vars || {}),
      rpc: (method, args) => { rpcCalls.push({ method, args }); return Promise.resolve({ ok: true }) },
      toast: () => {}, modalErr: (e) => { throw new Error('不应报错：' + e) }, renderInjectManager: () => {}, loadNotes: () => {},
      injectScopeLabel: () => '所有会话',
    }
    const doInjMgrSet = new Function('ctx', 'with (ctx) { ' + m[0] + '\nreturn doInjMgrSet }')(ctx)   /* injMgrSetDirect 随提取块一并入沙箱（同 ctx 闭环） */
    const n = { id: 'n-x103', title: '行内闸探针', kind: 'note', inject: false }
    // dismiss：confirm 拦截 → 零 RPC 零副作用
    ctx.__ret = false
    doInjMgrSet(n, 'convention')
    assert(confirmCalls.length === 1 && rpcCalls.length === 0, 'dismiss 确认条 = 零副作用（confirm 调 1 次，rpc 零调用）')
    assert(confirmCalls[0].indexOf('meta.convInjectConfirm') >= 0 && confirmCalls[0].indexOf('行内闸探针') >= 0, 'confirm 文案 = meta.convInjectConfirm 键 + 标题入参')
    // accept：放行 → notes-update {inject:true, injectRole:'convention'}
    ctx.__ret = true
    doInjMgrSet(n, 'convention')
    assert(rpcCalls.length === 1 && rpcCalls[0].method === 'notes-update' && rpcCalls[0].args.inject === true && rpcCalls[0].args.injectRole === 'convention', 'accept 确认条 = 发 notes-update 翻约定档（实得 ' + JSON.stringify(rpcCalls[0]) + '）')
    // 切 off：无确认闸
    doInjMgrSet({ id: n.id, title: n.title, kind: 'note', inject: true, injectRole: 'convention' }, 'off')
    assert(confirmCalls.length === 2 && rpcCalls.length === 2 && rpcCalls[1].args.inject === false, '切 off 档免确认闸（confirm 不再调用，rpc 直发 inject:false）')
    await Promise.resolve()   // rpc .then 微任务落定（防未捕获告警）
  })

  // ===== ⑥ backfill 降噪：静态锚（发布包） =====
  await t('0.4.7-A⑥ backfill 静态锚：cwd 兜底 helper + telemetry 记账跳过 + 汇总单行 + 逐行 skip 日志清零', () => {
    assert(indexSrc.indexOf('function _wsOfNoteCwd(') >= 0, 'index.mjs 含 _wsOfNoteCwd（笔记自身 cwd 精确匹配注册表）')
    assert(indexSrc.indexOf('wsBackfillSkip') >= 0, 'index.mjs 含 telemetry meta.wsBackfillSkip 记账跳过（幂等）')
    assert(indexSrc.indexOf("'notes: workspace backfill done, fixed='") >= 0, 'index.mjs 汇总单行锚')
    assert(indexSrc.indexOf("'notes: workspace backfill skip '") < 0, 'index.mjs 逐行 skip 日志已清零（降噪）')
  })

  // ===== ⑥ 行为级：静态包冷实例两轮启动——一轮 cwd 推导修复 + 不可推导记账；二轮记账命中零重扫 =====
  await t('0.4.7-A⑥ 行为级：冷实例 backfill——cwd 推导落 workspace / 不可推导记账跳过 / 逐行日志清零 / 二轮幂等', async () => {
    const NR = path.join(osNative.homedir(), '.dsh', 'notes')
    const WS_DIR = path.dirname(DIR)
    const fmOf = (id, title, extra) => '---\nid: ' + id + '\ntitle: ' + title + '\ntopic: 测试\nstatus: active\ncreatedAt: "2026-01-01T00:00:00.000Z"\nupdatedAt: "2026-01-01T00:00:00.000Z"\n' + (extra || '') + '---\n\n正文\n'
    const storeB = new Map()
    storeB.set(path.join(NR, 'n-bf1.md'), fmOf('n-bf1', '回填探针甲', 'cwd: "' + String(WS_DIR).replace(/\\/g, '\\\\') + '"\n'))                 // sessionId 缺席 → cwd 精确匹配注册表推导
    storeB.set(path.join(NR, 'n-bf2.md'), fmOf('n-bf2', '回填探针乙', ''))                                                                                              // 无线索 → 不可推导 → 记账
    storeB.set(path.join(NR, 'n-bf3.md'), fmOf('n-bf3', '回填探针丙', 'sessionId: session-abc12345-0000-0000-0000-000000000000\n'))                                       // 既有 live 推导通道不回归
    const rawBf2 = storeB.get(path.join(NR, 'n-bf2.md'))
    const fsMockB = {
      resolve: async (p) => p,
      stat: async (p) => (p === NR ? { dir: true } : (storeB.has(p) ? { file: true } : null)),
      listDir: async (p) => {
        if (p !== NR) return []
        const out = []
        for (const k of storeB.keys()) if (k.indexOf(NR + '\\') === 0 && k.indexOf('\\', NR.length + 1) < 0) out.push({ name: k.slice(NR.length + 1) })
        return out
      },
      readText: async (p) => { if (!storeB.has(p)) throw new Error('ENOENT: ' + p); return storeB.get(p) },
      writeText: async (p, c) => { storeB.set(p, c) },
    }
    const logLines = []
    const origLog = console.log
    const harnessBackup = global.harness
    console.log = (...a) => { logLines.push(a.map(String).join(' ')); origLog.apply(console, a) }
    try {
      delete global.harness   // 静态包冷实例：webServer/tools 兜底通道（节 99 同款）
      const boot = async (tag) => {
        const mod = await import(pathToFileURL(H.INDEX_PATH).href + '?bf047a=' + tag)
        mod.apply({
          fs: fsMockB, sandboxPolicy: { resolve: () => ({}) },
          webServer: { register: () => () => {} }, tools: { register: () => () => {} },
          get: (name) => ({ agents: S.agentsMock, systemPrompt: { context: () => () => {} }, sessionPersistence: S.sessionPersistenceMock, workspaceRegistry: S.workspaceRegistryMock, sessionTitle: S.sessionTitleMock, sessionQuery: S.sessionQueryMock })[name],
          effect: () => {}, on: () => () => {},
        })
        // backfill 为 fire-and-forget：轮询汇总行落定（≤5s）
        for (let i = 0; i < 50; i++) {
          await new Promise(r => setTimeout(r, 100))
          if (logLines.some(l => l.indexOf('workspace backfill done') >= 0)) return
        }
      }
      await boot('run1')
      const sum1 = logLines.filter(l => l.indexOf('workspace backfill done') >= 0)
      assert(sum1.length === 1, '一轮启动：汇总行恰好一行（实得 ' + JSON.stringify(sum1) + '｜全部 backfill 相关：' + JSON.stringify(logLines.filter(l => l.indexOf('backfill') >= 0)) + '）')
      assert(sum1[0].indexOf('fixed=2') >= 0 && sum1[0].indexOf('skipped=1') >= 0, '一轮汇总计数 fixed=2 skipped=1（实得 ' + sum1[0] + '）')
      assert(logLines.filter(l => l.indexOf('workspace backfill skip ') >= 0).length === 0, '一轮逐行 skip 日志清零（降噪核心）')
      assert(storeB.get(path.join(NR, 'n-bf1.md')).indexOf('workspace: deepseek-work') >= 0, 'n-bf1：cwd 精确匹配注册表 → workspace 落账（实得 ' + storeB.get(path.join(NR, 'n-bf1.md')).split('\n').slice(0, 12).join('|') + '）')
      assert(storeB.get(path.join(NR, 'n-bf3.md')).indexOf('workspace: deepseek-work') >= 0, 'n-bf3：live sessionId 推导通道不回归')
      assert.strictEqual(storeB.get(path.join(NR, 'n-bf2.md')), rawBf2, 'n-bf2：不可推导零写入（原文原样）')
      const telem1 = JSON.parse(storeB.get(path.join(NR, 'telemetry.json')) || '{}')
      assert(telem1.meta && telem1.meta.wsBackfillSkip && telem1.meta.wsBackfillSkip['n-bf2'] === 1, 'n-bf2 已记账 telemetry.json meta.wsBackfillSkip（实得 ' + JSON.stringify(telem1.meta || {}) + '）')
      const logsAfterRun1 = logLines.length
      await boot('run2')
      const sum2 = logLines.slice(logsAfterRun1).filter(l => l.indexOf('workspace backfill done') >= 0)
      assert(sum2.length === 1, '二轮启动：汇总行仍恰好一行（实得 ' + JSON.stringify(sum2) + '）')
      assert(sum2[0].indexOf('fixed=0') >= 0 && sum2[0].indexOf('skipped=0') >= 0 && sum2[0].indexOf('ledgered=1') >= 0, '二轮幂等：记账命中零重扫（实得 ' + sum2[0] + '）')
      assert(logLines.slice(logsAfterRun1).filter(l => l.indexOf('workspace backfill skip ') >= 0).length === 0, '二轮逐行 skip 日志仍清零')
      assert.strictEqual(storeB.get(path.join(NR, 'n-bf2.md')), rawBf2, '二轮 n-bf2 仍零写入（幂等跳过生效）')
    } finally {
      console.log = origLog
      global.harness = harnessBackup
    }
  })
  }
}
